import type { RegularAtomToken, TimelineToken, TransactionToken } from "atom.io"
import { atom, runTransaction, timeline, transaction } from "atom.io"
import { IMPLICIT } from "atom.io/internal"
import * as v from "vitest"

type Scenario = {
	eventCount: number
	depth: number
	timelineCount: number
	topicOverlap: number
}

const SCENARIOS: Scenario[] = [
	{ eventCount: 128, depth: 0, timelineCount: 4, topicOverlap: 1 },
	{ eventCount: 512, depth: 0, timelineCount: 4, topicOverlap: 1 },
	{ eventCount: 512, depth: 0, timelineCount: 32, topicOverlap: 1 },
	{ eventCount: 512, depth: 4, timelineCount: 32, topicOverlap: 1 },
	{ eventCount: 512, depth: 4, timelineCount: 32, topicOverlap: 0.25 },
]

function prepareScenario(scenario: Scenario): () => void {
	const { depth, eventCount, timelineCount, topicOverlap } = scenario
	const overlapPercent = topicOverlap * 100
	const prefix =
		`benchmark/timeline-transaction-routing/` +
		`${eventCount}-${depth}-${timelineCount}-${overlapPercent}`
	const atoms = Array.from({ length: eventCount }, (_, index) =>
		atom<number>({
			key: `${prefix}/atom/${index}`,
			default: 0,
		}),
	)
	const trackedCount = Math.max(
		timelineCount,
		Math.floor(eventCount * topicOverlap),
	)
	const scopes = Array.from(
		{ length: timelineCount },
		(): RegularAtomToken<number>[] => [],
	)
	for (let index = 0; index < trackedCount; ++index) {
		scopes[index % timelineCount].push(atoms[index])
	}
	const timelines = scopes.map((scope, index) =>
		timeline({
			key: `${prefix}/timeline/${index}`,
			scope,
		}),
	)

	let action: TransactionToken<(value: number) => void> = transaction({
		key: `${prefix}/transaction/0`,
		do: ({ set }, value: number) => {
			for (const state of atoms) set(state, value)
		},
	})
	for (let level = 1; level <= depth; ++level) {
		const child = action
		action = transaction({
			key: `${prefix}/transaction/${level}`,
			do: ({ run }, value: number) => {
				run(child, `${prefix}/instance/${level}`)(value)
			},
		})
	}

	const run = runTransaction(action, `${prefix}/instance/root`)
	let nextValue = 0
	return () => {
		run(++nextValue)
		resetTimelineHistories(timelines)
	}
}

function resetTimelineHistories(timelines: TimelineToken<any>[]): void {
	for (const token of timelines) {
		const data = IMPLICIT.STORE.timelines.get(token.key)
		if (data) {
			data.at = 0
			data.history.length = 0
		}
	}
}

for (const scenario of SCENARIOS) {
	const run = prepareScenario(scenario)
	const overlapPercent = scenario.topicOverlap * 100
	v.bench(
		`${scenario.eventCount} events, depth ${scenario.depth}, ` +
			`${scenario.timelineCount} timelines, ${overlapPercent}% overlap`,
		run,
		{
			time: 600,
			iterations: 10,
			warmupTime: 100,
			warmupIterations: 3,
		},
	)
}
