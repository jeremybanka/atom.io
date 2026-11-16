import type { Json } from "atom.io/foundations/json"

import type {
	RealtimeRequestIdentity,
	RealtimeRequestResult,
} from "./realtime-result.ts"
import type { StandardSchemaV1 } from "./standard-schema.ts"

export type RealtimeCommand<
	Parameters extends Json.Serializable,
	Value extends Json.Serializable,
> = {
	readonly name: string
	readonly parameters: StandardSchemaV1<unknown, Parameters>
	readonly result: StandardSchemaV1<unknown, Value>
}

export function realtimeCommand<
	Parameters extends Json.Serializable,
	Value extends Json.Serializable,
>(
	definition: RealtimeCommand<Parameters, Value>,
): RealtimeCommand<Parameters, Value> {
	if (!definition.name || definition.name.length > 256)
		throw new Error(`Invalid command name.`)
	return Object.freeze({ ...definition })
}

export type RealtimeCommandIdentity = RealtimeRequestIdentity<string>
export type RealtimeCommandRejection = {
	readonly code:
		| `invalid`
		| `unknown-command`
		| `unauthorized`
		| `collision`
		| `duplicate`
		| `capacity`
		| `failed`
		| `disposed`
	readonly reason: string
}
export type RealtimeCommandResult<
	Value extends Json.Serializable = Json.Serializable,
> = RealtimeCommandIdentity &
	RealtimeRequestResult<Value, RealtimeCommandRejection>
export type RealtimeCommandRequest = RealtimeCommandIdentity & {
	readonly parameters: Json.Serializable
}

/** Reject non-JSON data and bound work before handing it to an application schema. */
export function encodeRealtimePayload(
	value: unknown,
	maxBytes = 65_536,
	maxDepth = 32,
): string | null {
	let remaining = maxBytes
	const visit = (input: unknown, depth: number): boolean => {
		if (--remaining < 0 || depth > maxDepth) return false
		if (input === null || typeof input === `boolean`) return true
		if (typeof input === `number`) return Number.isFinite(input)
		if (typeof input === `string`) {
			remaining -= input.length
			return remaining >= 0
		}
		if (typeof input !== `object`) return false
		if (Array.isArray(input))
			return (
				input.length <= remaining &&
				input.every((item) => visit(item, depth + 1))
			)
		if (
			Object.getPrototypeOf(input) !== null &&
			Object.getPrototypeOf(Object.getPrototypeOf(input)) !== null
		)
			return false
		return Object.entries(input).every(([key, item]) => {
			remaining -= key.length
			return remaining >= 0 && visit(item, depth + 1)
		})
	}
	try {
		if (!visit(value, 0)) return null
		const encoded = JSON.stringify(value)
		return new TextEncoder().encode(encoded).byteLength <= maxBytes
			? encoded
			: null
	} catch {
		return null
	}
}
