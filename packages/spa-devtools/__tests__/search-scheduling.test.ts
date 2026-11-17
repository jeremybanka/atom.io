import { Silo } from "atom.io"
import { afterEach, expect, it, vi } from "vitest"

import { scheduleGraph } from "../src/ecology-graph.ts"
import type { SearchCapture, SearchIndex } from "../src/search.ts"
import { captureStateSearch, indexStateSearch } from "../src/search.ts"

const longKey =
	`alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi`
		.split(` `)
		.map((word) => word.padEnd(60, `x`))
		.join(` `)
function capture(key = longKey): SearchCapture {
	const app = new Silo({
		name: `scheduled-search`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	app.atom<number>({ key, default: 0 })
	return captureStateSearch(app.store, `atoms`)!
}
afterEach(() => {
	vi.restoreAllMocks()
})

it(`yields within a large admitted field before normalization work exhausts scheduler headroom`, () => {
	expect(longKey.length).toBe(975)
	const copied = capture(),
		queue: (() => void)[] = []
	let clock = 0,
		indexed: SearchIndex | undefined,
		chunks: number[] = []
	const normalize = String.prototype.normalize
	vi.spyOn(performance, `now`).mockImplementation(() => clock)
	vi.spyOn(String.prototype, `normalize`).mockImplementation(function (
		this: string,
		form,
	) {
		clock += 1
		return normalize.call(this, form)
	})
	scheduleGraph(
		indexStateSearch(copied),
		(value, durations) => {
			indexed = value
			chunks = durations
		},
		(run) => {
			queue.push(run)
			return () => {}
		},
		() => clock,
		2,
	)
	while (queue.length) queue.shift()!()
	expect(indexed!.documents[0].fields[0].words).toEqual(longKey.split(` `))
	expect(Math.max(...chunks)).toBeLessThanOrEqual(2)

	const done = vi.fn()
	const cancel = scheduleGraph(
		indexStateSearch(copied),
		done,
		(run) => {
			queue.push(run)
			return () => {}
		},
		() => clock,
		2,
	)
	const before = clock
	queue.shift()!()
	expect(clock - before).toBeLessThanOrEqual(2)
	cancel()
	while (queue.length) queue.shift()!()
	expect(done).not.toHaveBeenCalled()
})

it(`keeps word cursors independent when index jobs interleave inside their fields`, () => {
	const a = capture(),
		b = capture(
			`amber bronze coral denim emerald flax gold hazel ivory jade khaki lime mauve navy olive pink`,
		)
	let clock = 0
	vi.spyOn(performance, `now`).mockImplementation(() => ++clock)
	function finish(iterator: Generator<void, SearchIndex>): SearchIndex {
		let step = iterator.next()
		while (!step.done) step = iterator.next()
		return step.value
	}
	const expectedA = finish(indexStateSearch(a)),
		expectedB = finish(indexStateSearch(b))
	const jobA = indexStateSearch(a),
		jobB = indexStateSearch(b)
	let stepA = jobA.next(),
		stepB = jobB.next()
	while (!stepA.done || !stepB.done) {
		if (!stepA.done) stepA = jobA.next()
		if (!stepB.done) stepB = jobB.next()
	}
	expect(stepA.value).toEqual(expectedA)
	expect(stepB.value).toEqual(expectedB)
})
