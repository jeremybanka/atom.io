import type { Json } from "atom.io/foundations/json"

import type {
	MosaicDomainIdentity,
	MosaicDomainMemberAddress,
} from "./mosaic-domain.ts"

/** Wire version for ephemeral Mosaic Domain presence. */
export const MOSAIC_DOMAIN_PRESENCE_PROTOCOL_VERSION = 1 as const

export type MosaicDomainPresenceProtocolVersion =
	typeof MOSAIC_DOMAIN_PRESENCE_PROTOCOL_VERSION

export type MosaicDomainPresenceProposal<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly address: MosaicDomainMemberAddress<Identity>
	readonly domain: Identity
	readonly kind: `clear` | `update`
	readonly protocolVersion: MosaicDomainPresenceProtocolVersion
	readonly sequence: number
	readonly session: string
	readonly value?: Json.Serializable
}

export type MosaicDomainPresenceEnvelope<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = MosaicDomainPresenceProposal<Identity> & {
	readonly actor: string
	readonly expiresAt: number | null
}

export type MosaicDomainPresenceRejectionCode =
	| `backpressure`
	| `capacity-exceeded`
	| `incompatible-version`
	| `invalid-payload`
	| `rate-limited`
	| `stale`
	| `unauthorized`

export type MosaicDomainPresenceRejection = {
	readonly code: MosaicDomainPresenceRejectionCode
	readonly reason: string
	readonly recovery: `discard-update` | `retry` | `upgrade`
	readonly sequence: number | null
}

export type MosaicDomainPresenceResult =
	| {
			readonly accepted: MosaicDomainPresenceEnvelope
			readonly status: `accepted`
	  }
	| {
			readonly rejection: MosaicDomainPresenceRejection
			readonly status: `rejected`
	  }

export type MosaicDomainPresenceSnapshot = {
	readonly presence: readonly MosaicDomainPresenceEnvelope[]
	/** Last sequence accepted for the authenticated actor/session. */
	readonly sequence: number
}

export type MosaicDomainPresenceCleanupReason = `disconnect` | `expired`

export type MosaicDomainPresenceCleanup = {
	readonly presence: MosaicDomainPresenceEnvelope
	readonly reason: MosaicDomainPresenceCleanupReason
}

export type MosaicDomainPresenceLimits = {
	readonly maxBytes: number
	readonly maxPendingUpdates: number
	readonly maxSessions: number
	readonly maxUpdatesPerSecond: number
}

export const DEFAULT_MOSAIC_DOMAIN_PRESENCE_LIMITS: MosaicDomainPresenceLimits =
	Object.freeze({
		maxBytes: 16 * 1024,
		maxPendingUpdates: 64,
		maxSessions: 10_000,
		maxUpdatesPerSecond: 120,
	})

export const MOSAIC_DOMAIN_PRESENCE_EVENTS: Readonly<{
	accepted: string
	proposal: string
	result: string
	snapshot: string
	snapshotResult: string
}> = Object.freeze({
	accepted: `atom.io:mosaic-domain-presence:accepted`,
	proposal: `atom.io:mosaic-domain-presence:proposal`,
	result: `atom.io:mosaic-domain-presence:result`,
	snapshot: `atom.io:mosaic-domain-presence:snapshot`,
	snapshotResult: `atom.io:mosaic-domain-presence:snapshot-result`,
})

export type MosaicDomainPresenceRequest = {
	readonly proposal: MosaicDomainPresenceProposal
	readonly requestId: string
}

export type MosaicDomainPresenceResponse = {
	readonly requestId: string
	readonly result: MosaicDomainPresenceResult
}

export type MosaicDomainPresenceSnapshotRequest = { readonly requestId: string }

export type MosaicDomainPresenceSnapshotResponse = {
	readonly requestId: string
	readonly snapshot: MosaicDomainPresenceSnapshot
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === `object` && value !== null && !Array.isArray(value)

const validIdentifier = (value: unknown): value is string =>
	typeof value === `string` && value.length > 0 && value.length <= 512

const isJsonSerializable = (
	value: unknown,
	ancestors: WeakSet<object> = new WeakSet(),
): value is Json.Serializable => {
	if (
		value === null ||
		typeof value === `boolean` ||
		typeof value === `string`
	) {
		return true
	}
	if (typeof value === `number`) return Number.isFinite(value)
	if (typeof value !== `object` || ancestors.has(value)) return false
	ancestors.add(value)
	const prototype = Object.getPrototypeOf(value) as {
		readonly constructor?: { readonly name?: string }
	} | null
	const plainObject =
		prototype === null || prototype.constructor?.name === `Object`
	const valid = Array.isArray(value)
		? value.every((item) => isJsonSerializable(item, ancestors))
		: plainObject &&
			Object.values(value).every((item) => isJsonSerializable(item, ancestors))
	ancestors.delete(value)
	return valid
}

/** Reject malformed or ambiguous presence proposals before member validation. */
export function assertMosaicDomainPresenceProposal(
	value: unknown,
	limits: Pick<
		MosaicDomainPresenceLimits,
		`maxBytes`
	> = DEFAULT_MOSAIC_DOMAIN_PRESENCE_LIMITS,
): asserts value is MosaicDomainPresenceProposal {
	if (!isRecord(value))
		throw new Error(`Mosaic Domain presence must be an object.`)
	if (value[`protocolVersion`] !== MOSAIC_DOMAIN_PRESENCE_PROTOCOL_VERSION) {
		throw new Error(`Unsupported Mosaic Domain presence protocol version.`)
	}
	if (!validIdentifier(value[`session`])) {
		throw new Error(`A Mosaic Domain presence session ID is invalid.`)
	}
	if (
		!Number.isSafeInteger(value[`sequence`]) ||
		(value[`sequence`] as number) < 1
	) {
		throw new Error(
			`A Mosaic Domain presence sequence must be a positive integer.`,
		)
	}
	if (value[`kind`] !== `update` && value[`kind`] !== `clear`) {
		throw new Error(`A Mosaic Domain presence kind is invalid.`)
	}
	if (value[`kind`] === `update` ? !(`value` in value) : `value` in value) {
		throw new Error(
			value[`kind`] === `update`
				? `A Mosaic Domain presence update requires a value.`
				: `A Mosaic Domain presence clear cannot carry a value.`,
		)
	}
	if (!isJsonSerializable(value)) {
		throw new Error(`Mosaic Domain presence must be JSON-serializable.`)
	}
	let serialized: string
	try {
		serialized = JSON.stringify(value)
	} catch {
		throw new Error(`Mosaic Domain presence must be JSON-serializable.`)
	}
	if (serialized === undefined) {
		throw new Error(`Mosaic Domain presence must be JSON-serializable.`)
	}
	if (new TextEncoder().encode(serialized).byteLength > limits.maxBytes) {
		throw new Error(`Mosaic Domain presence exceeds ${limits.maxBytes} bytes.`)
	}
}
