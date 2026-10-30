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
export interface ClientResumption extends Resumption {
	dispose(): void
}

/** Capture once per browser owner; pass this scope to defaults and reset handlers. */
export function createResumption(
	source: Element | Payload = { version: 1, values: [] },
): ClientResumption {
	const payload: Payload =
		source && `querySelector` in source
			? JSON.parse(
					source.querySelector(`:scope > script[data-resumable]`)?.textContent ??
						`null`,
				)
			: source
	if (payload?.version !== 1 || !Array.isArray(payload.values))
		throw new Error(`resumable: invalid payload`)
	const values = new Map<string, Encoded>()
	for (const [key, value] of payload.values) {
		const id = keyOf(key)
		if (
			values.has(id) ||
			!Array.isArray(value) ||
			!(
				(value[0] === 0 && value.length === 1) ||
				(value[0] === 1 && value.length === 2)
			)
		)
			throw new Error(`resumable: invalid payload entry`)
		values.set(id, value)
	}
	const controller = new AbortController()
	return {
		read<T, Wire extends Json>(
			options: ResumableOptions<T, Wire>,
		): T | Promise<T> {
			controller.signal.throwIfAborted()
			const key = keyOf(options.key)
			const entry = values.get(key)
			if (entry) {
				if (options.client) values.delete(key)
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
			controller.abort()
		},
	}
}
export function resumable<T, Wire extends Json = Json>(
	options: ResumableOptions<T, Wire>,
	scope?: Resumption,
): T | Promise<T> {
	if (!scope)
		throw new Error(
			`resumable: capture createResumption(element) and pass its scope`,
		)
	return scope.read(options)
}
