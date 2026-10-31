import type {
	AstroApplicationContext,
	AstroStoreContext,
} from "./astro-shared.ts"

type Lifetime = {
	signal: AbortSignal
	onCleanup(cleanup: () => void): () => void
	dispose(): void
	cancelled: Promise<undefined>
}

function lifetime(): Lifetime {
	const controller = new AbortController()
	const cleanups = new Set<() => void>()
	let cancel!: () => void
	const cancelled = new Promise<undefined>((resolve) => {
		cancel = () => {
			resolve(undefined)
		}
	})
	return {
		signal: controller.signal,
		onCleanup(cleanup) {
			if (controller.signal.aborted) cleanup()
			else cleanups.add(cleanup)
			return () => {
				cleanups.delete(cleanup)
			}
		},
		cancelled,
		dispose() {
			if (controller.signal.aborted) return
			controller.abort()
			cancel()
			const errors: unknown[] = []
			for (const cleanup of [...cleanups].reverse()) {
				try {
					cleanup()
				} catch (error) {
					errors.push(error)
				}
			}
			cleanups.clear()
			if (errors.length)
				throw new AggregateError(errors, `spa: Astro store cleanup failed`)
		},
	}
}

export type Application = Lifetime &
	AstroApplicationContext & { canResume: boolean }
export function applicationContext(): Application {
	const life = lifetime()
	const resources = new Map<unknown, unknown>()
	life.onCleanup(() => {
		resources.clear()
	})
	return {
		...life,
		canResume: true,
		get<T>(key: unknown, initialize: () => T): T {
			life.signal.throwIfAborted()
			if (!resources.has(key)) resources.set(key, initialize())
			return resources.get(key) as T
		},
	}
}

/** Island resources and shared application resources have distinct owners. */
export function storeContext(
	element?: HTMLElement,
	shared?: ReturnType<typeof applicationContext>,
): {
	context: AstroStoreContext
	dispose(): void
	cancelled: Promise<undefined>
} {
	const life = lifetime()
	const application = shared ?? applicationContext()
	if (shared) life.onCleanup(shared.onCleanup(life.dispose))
	else life.onCleanup(application.dispose)
	return {
		context: {
			element,
			signal: life.signal,
			onCleanup: life.onCleanup,
			application,
		},
		dispose: life.dispose,
		cancelled: life.cancelled,
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
