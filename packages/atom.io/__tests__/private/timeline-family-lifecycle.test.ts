import {
	atomFamily,
	clearTimeline,
	disposeState,
	disposeTimeline,
	findState,
	findTimeline,
	getState,
	inspectTimeline,
	scopeFamily,
	setState,
	timelineFamily,
} from "atom.io"
import type { RootStore } from "atom.io/internal"
import {
	findTimelineInStore,
	getFromStore,
	IMPLICIT,
	inspectTimelineInStore,
	seekInStore,
	setIntoStore,
	Store,
	withdraw,
} from "atom.io/internal"
import { attachIntrospectionStates } from "atom.io/introspection"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"

const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	setTestLogLevel(null)
})

test(`timeline and atom disposal release routed resources`, () => {
	const introspection = attachIntrospectionStates(IMPLICIT.STORE)
	getState(introspection.timelineIndex)
	const countAtoms = atomFamily<number, string>({
		key: `count`,
		default: 0,
	})
	const countHistoryTimelines = timelineFamily<string>({
		key: `countHistory`,
		scope: [scopeFamily(countAtoms, { timelineKey: (countKey) => countKey })],
	})
	const timelineCount = IMPLICIT.STORE.timelines.size
	disposeTimeline(countHistoryTimelines, `missing`)
	expect(IMPLICIT.STORE.timelines.size).toBe(timelineCount)
	const historyA = findTimeline(countHistoryTimelines, `a`)
	const historyB = findTimeline(countHistoryTimelines, `b`)
	const countA = findState(countAtoms, `a`)
	const countB = findState(countAtoms, `b`)
	getState(countA)
	getState(countB)
	getState(introspection.timelineSelectors, historyA.key)
	clearTimeline(historyA)
	setState(countA, 1)

	const timelineA = withdraw(IMPLICIT.STORE, historyA)
	const timelineB = withdraw(IMPLICIT.STORE, historyB)
	expect(timelineA.subscriptions.size).toBe(1)
	expect(IMPLICIT.STORE.timelineTopics.getRelatedKey(countA.key)).toBe(
		historyA.key,
	)

	disposeState(countA)
	expect(timelineA.subscriptions.size).toBe(0)
	expect(IMPLICIT.STORE.timelineTopics.getRelatedKey(countA.key)).toBeUndefined()
	expect(timelineA.history.at(-1)?.type).toBe(`atom_disposal`)

	getState(countA)
	expect(timelineA.subscriptions.size).toBe(1)
	disposeTimeline(historyA)

	expect(IMPLICIT.STORE.timelines.has(historyA.key)).toBe(false)
	expect(
		IMPLICIT.STORE.timelineTopics.getRelatedKeys(historyA.key),
	).toBeUndefined()
	expect(timelineA.subscriptions.size).toBe(0)
	expect(timelineA.subject.subscribers.size).toBe(0)
	expect(timelineA.history).toEqual([])
	expect(IMPLICIT.STORE.timelines.get(historyB.key)).toBe(timelineB)
	expect(
		getState(introspection.timelineIndex).some(
			(token) => token.key === historyA.key,
		),
	).toBe(false)
	expect(
		seekInStore(IMPLICIT.STORE, introspection.timelineSelectors, historyA.key),
	).toBeUndefined()
})

test(`store cloning installs timeline families before their members`, () => {
	const countAtoms = atomFamily<number, string>({
		key: `count`,
		default: 0,
	})
	const countHistoryTimelines = timelineFamily<string>({
		key: `countHistory`,
		scope: [scopeFamily(countAtoms, { timelineKey: (countKey) => countKey })],
	})
	const history = findTimeline(countHistoryTimelines, `a`)
	setState(countAtoms, `a`, 1)

	const clone = new Store(
		{
			name: `timeline-family-clone`,
			lifespan: `ephemeral`,
			isProduction: false,
		},
		IMPLICIT.STORE,
	) as RootStore
	const clonedHistory = findTimelineInStore(clone, countHistoryTimelines, `a`)

	expect(inspectTimelineInStore(clone, clonedHistory)).toEqual(
		inspectTimeline(history),
	)
	expect(getFromStore(clone, countAtoms, `a`)).toBe(0)
	setIntoStore(clone, countAtoms, `a`, 2)
	expect(inspectTimelineInStore(clone, clonedHistory)).toEqual({
		at: 2,
		length: 2,
	})
	expect(getState(countAtoms, `a`)).toBe(1)
})
