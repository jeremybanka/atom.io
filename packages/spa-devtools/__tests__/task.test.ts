import { afterEach, expect, it, vi } from "vitest"

import { scheduleGraph } from "../src/ecology-graph.ts"
import { scheduleTask } from "../src/task.ts"

afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
	vi.useRealTimers()
})
it(`uses cancellable browser tasks without swallowing callback errors`, async () => {
	let reject: (error: unknown) => void = () => {}
	const postTask = vi.fn(
		(_run: () => void, _options: { signal: AbortSignal }) =>
			new Promise<void>((_resolve, fail) => {
				reject = fail
			}),
	)
	vi.stubGlobal(`scheduler`, { postTask })
	const microtask = vi
		.spyOn(globalThis, `queueMicrotask`)
		.mockImplementation(() => {})
	const cancel = scheduleTask(() => {})
	const signal = postTask.mock.calls[0][1].signal
	expect(signal.aborted).toBe(false)
	cancel()
	reject(signal.reason)
	await Promise.resolve()
	expect(signal.aborted).toBe(true)
	expect(microtask).not.toHaveBeenCalled()
	const cancelError = scheduleTask(() => {})
	const error = new Error(`callback failed`)
	reject(error)
	await Promise.resolve()
	expect(microtask).toHaveBeenCalledOnce()
	expect(() => {
		microtask.mock.calls[0][0]()
	}).toThrow(error)
	cancelError()
	const cancelLateError = scheduleTask(() => {})
	cancelLateError()
	reject(error)
	await Promise.resolve()
	expect(microtask).toHaveBeenCalledTimes(2)
})
it(`falls back to a cancellable timer when postTask is unavailable`, () => {
	vi.useFakeTimers()
	vi.stubGlobal(`scheduler`, {})
	const run = vi.fn()
	scheduleTask(run)
	vi.runAllTimers()
	expect(run).toHaveBeenCalledOnce()
	scheduleTask(run)()
	vi.runAllTimers()
	expect(run).toHaveBeenCalledOnce()
})
it(`budgets elapsed work and leaves room for the measured next step on slower hardware`, () => {
	let clock = 0
	const queue: (() => void)[] = [],
		counts: number[] = []
	function* work() {
		for (let i = 0; i < 10; i++) {
			clock += 3
			counts.push(i)
			yield
		}
		return 10
	}
	const done = vi.fn()
	scheduleGraph(
		work(),
		done,
		(run) => {
			queue.push(run)
			return () => {}
		},
		() => clock,
		4,
	)
	queue.shift()!()
	expect(counts).toHaveLength(1)
	while (queue.length) queue.shift()!()
	expect(done.mock.calls[0][0]).toBe(10)
	expect(Math.max(...done.mock.calls[0][1])).toBe(3)
})
