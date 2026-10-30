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

const active = new AsyncLocalStorage<Resumption>()

export function resumable<T, Wire extends Json = Json>(
	options: ResumableOptions<T, Wire>,
	scope?: Resumption,
): T | Promise<T> {
	const context = scope ?? active.getStore()
	if (!context)
		throw new Error(`resumable: use collect() or the Astro Resumption wrapper`)
	return context.read(options)
}

/** Await the callback and every producer it discovers, including nested async work. */
export async function collect<T>(
	run: () => T | Promise<T>,
	options: { signal?: AbortSignal } = {},
): Promise<{ value: T; payload: Payload }> {
	const controller = new AbortController()
	const signal = options.signal
		? AbortSignal.any([options.signal, controller.signal])
		: controller.signal
	const tasks = new Map<string, Promise<unknown>>()
	const payload: Payload = { version: 1, values: [] }
	let closed = false
	const scope: Resumption = {
		read<Output, Wire extends Json>(
			settings: ResumableOptions<Output, Wire>,
		): Promise<Output> {
			if (closed) throw new Error(`resumable: collection is closed`)
			signal.throwIfAborted()
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
	}
	let abort!: () => void
	const aborted = new Promise<never>((_, reject) => {
		abort = () => {
			reject(signal.reason)
		}
		signal.addEventListener(`abort`, abort, { once: true })
	})
	try {
		signal.throwIfAborted()
		return await Promise.race([
			aborted,
			active.run(scope, async () => {
				const value = await run()
				let drained = 0
				while (tasks.size > drained) {
					const batch = [...tasks.values()].slice(drained)
					drained = tasks.size
					await Promise.all(batch)
				}
				return { value, payload }
			}),
		])
	} finally {
		closed = true
		signal.removeEventListener(`abort`, abort)
		controller.abort()
	}
}
