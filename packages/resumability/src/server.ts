import { AsyncLocalStorage } from "node:async_hooks"

import { keyOf } from "./key.ts"
import type { Json, Payload, ResumableOptions, Resumption } from "./types.ts"
import { encode } from "./wire.ts"

export type {
	Codec,
	Context,
	Json,
	Key,
	Payload,
	ResumableOptions,
	Resumption,
} from "./types.ts"
export { serialize } from "./wire.ts"

const active = new AsyncLocalStorage<ServerCollection>()

export function resumable<T, Wire extends Json = Json>(
	options: ResumableOptions<T, Wire>,
	scope?: Resumption,
): T | Promise<T> {
	const context = scope ?? active.getStore()
	if (!context)
		throw new Error(`resumable: use collect() or the Astro Resumption wrapper`)
	return context.read(options)
}

export interface ServerCollection extends Resumption {
	readonly signal: AbortSignal
	run<T>(compute: () => T): T
	collect<T>(
		compute: () => T | Promise<T>,
		options?: { drain?: boolean },
	): Promise<{ value: T; payload: Payload }>
	/** A detached snapshot of completed values, also available after disposal. */
	snapshot(): Payload
	dispose(): void
}

/** The surrounding explicit collection takes precedence over an adapter's default. */
export function currentCollection(): ServerCollection | undefined {
	return active.getStore()
}

/** A collector whose owner controls its lifetime, including streamed responses. */
export function createCollection(
	options: { signal?: AbortSignal } = {},
): ServerCollection {
	const controller = new AbortController()
	const signal = options.signal
		? AbortSignal.any([options.signal, controller.signal])
		: controller.signal
	const tasks = new Map<string, Promise<unknown>>()
	const payload: Payload = { version: 1, values: [] }
	let closed = false
	const assertOpen = () => {
		if (closed) throw new Error(`resumable: collection is closed`)
		signal.throwIfAborted()
	}
	const scope: ServerCollection = {
		signal,
		read<Output, Wire extends Json>(
			settings: ResumableOptions<Output, Wire>,
		): Promise<Output> {
			assertOpen()
			const key = keyOf(settings.key)
			let task = tasks.get(key)
			if (!task) {
				task = Promise.resolve()
					.then(() => settings.server({ signal }))
					.then((value) => {
						signal.throwIfAborted()
						const encoded = encode(
							settings.codec ? settings.codec.encode(value) : value,
						)
						payload.values.push([JSON.parse(key), encoded])
						return settings.codec
							? settings.codec.decode(encoded[1] as Wire)
							: encoded[1]
					})
				tasks.set(key, task)
				// The collector owns rejection handling, even for a fire-and-forget call.
				void task.catch(() => {})
			}
			return task as Promise<Output>
		},
		run<T>(compute: () => T): T {
			assertOpen()
			return active.run(scope, compute)
		},
		async collect<T>(
			compute: () => T | Promise<T>,
			captureOptions: { drain?: boolean } = {},
		): Promise<{ value: T; payload: Payload }> {
			let abort!: () => void
			const aborted = new Promise<never>((_, reject) => {
				abort = () => {
					reject(signal.reason)
				}
				signal.addEventListener(`abort`, abort, { once: true })
			})
			try {
				return await Promise.race([
					aborted,
					scope.run(async () => {
						const value = await compute()
						let drained = 0
						while (captureOptions.drain !== false && tasks.size > drained) {
							const batch = [...tasks.values()].slice(drained)
							drained = tasks.size
							await Promise.all(batch)
						}
						return { value, payload: scope.snapshot() }
					}),
				])
			} finally {
				signal.removeEventListener(`abort`, abort)
			}
		},
		snapshot() {
			return structuredClone(payload)
		},
		dispose() {
			closed = true
			controller.abort()
			tasks.clear()
		},
	}
	return scope
}

/** Await the callback and every producer it discovers, then close the scope. */
export async function collect<T>(
	run: () => T | Promise<T>,
	options: { signal?: AbortSignal } = {},
): Promise<{ value: T; payload: Payload }> {
	const scope = createCollection(options)
	try {
		return await scope.collect(run)
	} finally {
		scope.dispose()
	}
}
