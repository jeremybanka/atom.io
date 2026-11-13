import type { Rect } from "../../../src/window-geometry.ts"

export interface FrameSample {
	dispatchMs: number
	handlerToFrameMs: number
	dispatchToFrameMs: number
	nextFrameProxyMs: number | null
	before: Rect
	observed: Rect
}

/** Observe geometry in the first rAF registered after dispatch; the later frame is only a clock proxy. */
export function measureFrameSample({
	task,
	frame,
	now,
	dispatch,
	read,
}: {
	task(callback: () => void): void
	frame(callback: () => void): void
	now(): number
	dispatch(): void
	read(): Rect
}): Promise<FrameSample> {
	return new Promise((resolve, reject) => {
		// A fresh task prevents input from being dispatched inside a frame callback.
		task(() => {
			try {
				const before = read()
				const start = now()
				dispatch()
				const handled = now()
				frame(() => {
					try {
						const observedAt = now()
						const sample: FrameSample = {
							dispatchMs: handled - start,
							handlerToFrameMs: observedAt - handled,
							dispatchToFrameMs: observedAt - start,
							nextFrameProxyMs: null,
							before,
							observed: read(),
						}
						frame(() => {
							sample.nextFrameProxyMs = now() - start
						})
						resolve(sample)
					} catch (error) {
						reject(error)
					}
				})
			} catch (error) {
				reject(error)
			}
		})
	})
}
