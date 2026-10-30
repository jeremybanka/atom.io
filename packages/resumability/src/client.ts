import { keyOf } from "./key.ts"
import type {
	Encoded,
	Json,
	Payload,
	ResumableOptions,
	Resumption,
} from "./types.ts"

export type {
	Codec,
	Context,
	Json,
	Key,
	Payload,
	ResumableOptions,
	Resumption,
} from "./types.ts"
let active: Resumption | undefined

export interface ClientResumption extends Resumption {
	/** Activate this scope for synchronous calls; async producers capture their signal at invocation. */
	run<T>(compute: () => T, options?: { resume: boolean }): T
	/** Import unused keys without reseeding keys already read by this application. */
	add(source: Element | Payload): void
	dispose(): void
}

/** Capture once per browser owner, then activate it when evaluating defaults. */
export function createResumption(
	source: Element | Payload = { version: 1, values: [] },
): ClientResumption {
	const values = new Map<string, Encoded>()
	const used = new Set<string>()
	let resume = true
	const controller = new AbortController()
	const scope: ClientResumption = {
		run<T>(compute: () => T, options = { resume: true }): T {
			controller.signal.throwIfAborted()
			const previous = active
			const previousResume = resume
			resume = options.resume
			active = scope
			try {
				return compute()
			} finally {
				active = previous
				resume = previousResume
			}
		},
		add(addition) {
			controller.signal.throwIfAborted()
			const payload: Payload =
				addition && `querySelector` in addition
					? JSON.parse(
							addition.querySelector(`:scope > script[data-resumable]`)
								?.textContent ?? `null`,
						)
					: addition
			if (payload?.version !== 1 || !Array.isArray(payload.values))
				throw new Error(`resumable: invalid payload`)
			const entries = new Map<string, Encoded>()
			for (const [key, value] of payload.values) {
				const id = keyOf(key)
				if (
					entries.has(id) ||
					!Array.isArray(value) ||
					!(
						(value[0] === 0 && value.length === 1) ||
						(value[0] === 1 && value.length === 2)
					)
				)
					throw new Error(`resumable: invalid payload entry`)
				entries.set(id, value)
			}
			for (const [key, value] of entries)
				if (!used.has(key)) values.set(key, value)
		},
		read<T, Wire extends Json>(
			options: ResumableOptions<T, Wire>,
		): T | Promise<T> {
			controller.signal.throwIfAborted()
			const key = keyOf(options.key)
			const entry = values.get(key)
			if (entry || options.client) used.add(key)
			if (options.client) values.delete(key)
			if (entry && (resume || !options.client)) {
				const value = structuredClone(entry[1])
				return options.codec ? options.codec.decode(value as Wire) : (value as T)
			}
			if (!options.client)
				throw new Error(
					`resumable: no server value or client initializer for ${key}`,
				)
			return options.client({ signal: controller.signal })
		},
		dispose() {
			values.clear()
			used.clear()
			controller.abort()
		},
	}
	scope.add(source)
	return scope
}
export function resumable<T, Wire extends Json = Json>(
	options: ResumableOptions<T, Wire>,
	scope?: Resumption,
): T | Promise<T> {
	scope ??= active
	if (!scope)
		throw new Error(
			`resumable: capture createResumption(element), then use scope.run() or pass its scope`,
		)
	return scope.read(options)
}
