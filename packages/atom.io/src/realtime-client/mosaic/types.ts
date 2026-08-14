import type { MutableAtomToken, RegularAtomToken } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import type { RootStore } from "atom.io/internal"
import type {
	AnyMosaicTransceiver,
	MosaicAtomAddress,
	MosaicIntent,
	MosaicOperation,
	MosaicOperationProposal,
	MosaicPresenceEnvelope,
	MosaicRecovery,
	MosaicRejectionCode,
	MosaicSignal,
} from "atom.io/realtime"

export type MosaicClientStatus =
	| `live`
	| `offline`
	| `recovering`
	| `rejected`
	| `syncing`

/** The small transport surface required by the Store-bound client. */
export type MosaicClientTransport = {
	/** Socket.IO exposes this; transports without it are presumed connected. */
	readonly connected?: boolean
	emit(event: string, ...args: Json.Serializable[]): void
	off(event: string, listener?: (...args: Json.Serializable[]) => void): void
	on(event: string, listener: (...args: Json.Serializable[]) => void): void
}

export type MosaicClientIdKind = `group` | `operation` | `session`

export type MosaicClientIdContext = {
	readonly actor: string
	readonly kind: MosaicClientIdKind
	readonly now: number
	readonly sequence: number
	readonly session: string | null
}

/** Must return a unique stable ID for every supplied sequence. */
export type MosaicClientIdSource = (context: MosaicClientIdContext) => string

export type MosaicClientClock = {
	now(): number
}

export type MosaicClientProblem<
	T extends AnyMosaicTransceiver = AnyMosaicTransceiver,
> =
	| {
			readonly code: MosaicRejectionCode
			readonly discarded: readonly MosaicOperationProposal<MosaicOperation<T>>[]
			readonly kind: `rejection`
			readonly operationId: string | null
			readonly reason: string
			readonly recovery: MosaicRecovery
	  }
	| {
			readonly discarded: readonly MosaicOperationProposal<MosaicOperation<T>>[]
			readonly kind: `protocol`
			readonly reason: string
	  }

export type MosaicSubmitOptions = {
	/** Use `createGroupId` to group several intents into one undo gesture. */
	readonly group?: string | null
}

export type MosaicSyncOptions = {
	readonly actor: string
	readonly clock?: MosaicClientClock | (() => number)
	readonly idSource?: MosaicClientIdSource
	/** Stable for the lifetime of an outbox; supply it to persist across reloads. */
	readonly session?: string
	readonly transport?: MosaicClientTransport
}

export type MosaicSyncState<
	T extends AnyMosaicTransceiver,
	Presence extends Json.Serializable,
> = {
	readonly pending: readonly string[]
	readonly presence: readonly MosaicPresenceEnvelope<Presence>[]
	readonly problem: MosaicClientProblem<T> | null
	readonly revision: number
	readonly status: MosaicClientStatus
}

/** Store-owned control plane for an ordinary Mosaic mutable atom. */
export interface MosaicController<
	T extends AnyMosaicTransceiver,
	Presence extends Json.Serializable,
> {
	readonly actor: string
	readonly address: MosaicAtomAddress
	readonly atom: MutableAtomToken<T>
	readonly session: string
	readonly store: RootStore
	readonly syncState: RegularAtomToken<MosaicSyncState<T, Presence>>
	change(
		intent: MosaicIntent<T>,
		options?: MosaicSubmitOptions,
	): MosaicSignal<T> | null
	clearProblem(): void
	connect(transport: MosaicClientTransport): () => void
	createGroupId(): string
	dispose(): void
	publishPresence(presence: Presence | null): void
	/** Resend unacknowledged envelopes without assigning new operation IDs. */
	retryPending(): void
	/** Request a fresh checkpoint while retaining the optimistic outbox. */
	synchronize(): void
}
