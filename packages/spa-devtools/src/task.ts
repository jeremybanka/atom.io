interface TaskScheduler {
	postTask(run: () => void, options: { signal: AbortSignal }): Promise<void>
}
/** Yield a browser task without nested timer clamping; retain the timer fallback. */
export function scheduleTask(run: () => void): () => void {
	const scheduler = (
		globalThis as typeof globalThis & { scheduler?: TaskScheduler }
	).scheduler
	if (typeof scheduler?.postTask === `function`) {
		const controller = new AbortController()
		void scheduler
			.postTask(run, { signal: controller.signal })
			.catch((error: unknown) => {
				if (!controller.signal.aborted || error !== controller.signal.reason)
					queueMicrotask(() => {
						throw error
					})
			})
		return () => {
			controller.abort()
		}
	}
	const timer = setTimeout(run, 0)
	return () => {
		clearTimeout(timer)
	}
}
