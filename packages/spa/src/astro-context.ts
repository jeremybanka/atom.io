import type { AstroStoreContext } from "./astro-shared.ts"

/** A preparation lifetime exists before there is a component owner. */
export function storeContext(element?: HTMLElement): {
	context: AstroStoreContext
	dispose(): void
	cancelled: Promise<undefined>
} {
	const controller = new AbortController()
	const cleanups: (() => void)[] = []
	let cancel!: () => void
	const cancelled = new Promise<undefined>((resolve) => {
		cancel = () => {
			resolve(undefined)
		}
	})
	return {
		context: {
			element,
			signal: controller.signal,
			onCleanup(cleanup) {
				if (controller.signal.aborted) cleanup()
				else cleanups.push(cleanup)
			},
		},
		cancelled,
		dispose() {
			if (controller.signal.aborted) return
			controller.abort()
			cancel()
			const errors: unknown[] = []
			for (const cleanup of cleanups.reverse()) {
				try {
					cleanup()
				} catch (error) {
					errors.push(error)
				}
			}
			cleanups.length = 0
			if (errors.length)
				throw new AggregateError(errors, `spa: Astro store cleanup failed`)
		},
	}
}

export function failPreparation(error: unknown, dispose: () => void): never {
	try {
		dispose()
	} catch (cleanup) {
		throw new AggregateError([error, cleanup])
	}
	throw error
}
