import { expect, it } from "vitest"

import { measureFrameSample } from "./fixtures/window-browser/timing.ts"

const original = { x: 0, y: 0, width: 500, height: 400 }
const changed = { ...original, x: 10 }
it(`separates synchronous dispatch, first-frame geometry and the later clock proxy`, async () => {
	let clock = 0,
		rect = original
	const tasks: (() => void)[] = [],
		frames: (() => void)[] = []
	const pending = measureFrameSample({
		task(callback) {
			tasks.push(callback)
		},
		frame(callback) {
			frames.push(callback)
		},
		now: () => clock,
		dispatch() {
			clock += 2
			frames.push(() => {
				rect = changed
			})
		},
		read: () => rect,
	})
	expect(frames).toHaveLength(0) // Dispatch has not run in the caller's frame.
	tasks.shift()!()
	clock = 16
	for (const callback of frames.splice(0)) callback()
	const sample = await pending
	expect(sample).toMatchObject({
		dispatchMs: 2,
		handlerToFrameMs: 14,
		dispatchToFrameMs: 16,
		before: original,
		observed: changed,
		nextFrameProxyMs: null,
	})
	clock = 32
	frames.shift()!()
	expect(sample.nextFrameProxyMs).toBe(32)
})
it(`records a no-op baseline without confusing its later frame with geometry latency`, async () => {
	let clock = 0
	const tasks: (() => void)[] = [],
		frames: (() => void)[] = []
	const pending = measureFrameSample({
		task(callback) {
			tasks.push(callback)
		},
		frame(callback) {
			frames.push(callback)
		},
		now: () => clock,
		dispatch() {},
		read: () => original,
	})
	tasks.shift()!()
	clock = 16.67
	frames.shift()!()
	const sample = await pending
	clock = 33.34
	frames.shift()!()
	expect(sample.dispatchMs).toBe(0)
	expect(sample.dispatchToFrameMs).toBe(16.67)
	expect(sample.nextFrameProxyMs).toBe(33.34)
	expect(sample.observed).toEqual(original)
})
it(`exposes a one-frame-late controller update instead of accepting any later changed geometry`, async () => {
	let rect = original
	const tasks: (() => void)[] = [],
		frames: (() => void)[] = []
	const pending = measureFrameSample({
		task(callback) {
			tasks.push(callback)
		},
		frame(callback) {
			frames.push(callback)
		},
		now: () => 0,
		dispatch() {
			frames.push(() => {
				frames.push(() => {
					rect = changed
				})
			})
		},
		read: () => rect,
	})
	tasks.shift()!()
	for (const callback of frames.splice(0)) callback()
	const sample = await pending
	expect(sample.observed).not.toEqual(changed)
	for (const callback of frames.splice(0)) callback()
	expect(rect).toEqual(changed)
	expect(sample.observed).toEqual(original) // The late result cannot rewrite the first-frame observation.
})
it(`rejects failed dispatch or geometry reads instead of leaving a measurement pending`, async () => {
	for (const failure of [`before`, `dispatch`, `observed`]) {
		let reads = 0
		const pending = measureFrameSample({
			task(callback) {
				callback()
			},
			frame(callback) {
				callback()
			},
			now: () => 0,
			dispatch() {
				if (failure === `dispatch`) throw new Error(failure)
			},
			read() {
				if (failure === `before` || (failure === `observed` && reads++ > 0))
					throw new Error(failure)
				return original
			},
		})
		await expect(pending).rejects.toThrow(failure)
	}
})
