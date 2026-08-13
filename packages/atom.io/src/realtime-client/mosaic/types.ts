import type { Json } from "atom.io/foundations/json"
import type {
	AnyMosaicModel,
	MosaicIntent,
	MosaicOperation,
	MosaicOperationProposal,
	MosaicPresenceEnvelope,
	MosaicRecovery,
	MosaicRejectionCode,
	MosaicResource,
	MosaicState,
} from "atom.io/realtime"

export type MosaicClientStatus =
	| `live`
	| `offline`
	| `recovering`
	| `rejected`
	| `syncing`

/** The small transport surface required by the framework-independent client. */
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

export type MosaicClientHistoryAdapter<Model extends AnyMosaicModel, History> = {
	/** Create the model intent whose validation enforces selective history. */
	intent(
		mode: `redo` | `undo`,
		state: MosaicState<Model>,
		actor: string,
	): MosaicIntent<Model> | null
	/** Project the actor's individualized history for observers. */
	read(state: MosaicState<Model>, actor: string): History
}

export type MosaicClientProblem<Model extends AnyMosaicModel = AnyMosaicModel> =
	| {
			readonly code: MosaicRejectionCode
			readonly discarded: readonly MosaicOperationProposal<
				MosaicOperation<Model>
			>[]
			readonly kind: `rejection`
			readonly operationId: string | null
			readonly reason: string
			readonly recovery: MosaicRecovery
	  }
	| {
			readonly discarded: readonly MosaicOperationProposal<
				MosaicOperation<Model>
			>[]
			readonly kind: `protocol`
			readonly reason: string
	  }

export type MosaicClientSnapshot<
	Model extends AnyMosaicModel,
	Presence extends Json.Serializable,
	History,
> = {
	readonly actor: string
	readonly history: History
	readonly pendingOperationIds: readonly string[]
	readonly presence: readonly MosaicPresenceEnvelope<Presence>[]
	readonly problem: MosaicClientProblem<Model> | null
	readonly resource: MosaicResource<Model>
	readonly revision: number
	readonly session: string
	readonly state: MosaicState<Model>
	readonly status: MosaicClientStatus
}

export type MosaicSubmitOptions = {
	/** Use `createGroupId` to group several intents into one undo gesture. */
	readonly group?: string | null
}

export type MosaicClientOptions<Model extends AnyMosaicModel, History> = {
	readonly actor: string
	readonly clock?: MosaicClientClock | (() => number)
	readonly history?: MosaicClientHistoryAdapter<Model, History>
	readonly idSource?: MosaicClientIdSource
	readonly resource: MosaicResource<Model>
	/** Stable for the lifetime of an outbox; supply it to persist across reloads. */
	readonly session?: string
	readonly transport?: MosaicClientTransport
}

export interface MosaicClient<
	Model extends AnyMosaicModel,
	Presence extends Json.Serializable,
	History,
> {
	clearProblem(): void
	connect(transport: MosaicClientTransport): () => void
	createGroupId(): string
	dispose(): void
	publishPresence(presence: Presence | null): void
	read(): MosaicClientSnapshot<Model, Presence, History>
	/** Resend unacknowledged envelopes without assigning new operation IDs. */
	retryPending(): void
	redo(
		options?: MosaicSubmitOptions,
	): MosaicOperationProposal<MosaicOperation<Model>> | null
	/** Request a fresh checkpoint while retaining the optimistic outbox. */
	synchronize(): void
	submit(
		intent: MosaicIntent<Model>,
		options?: MosaicSubmitOptions,
	): MosaicOperationProposal<MosaicOperation<Model>> | null
	subscribe(
		listener: (snapshot: MosaicClientSnapshot<Model, Presence, History>) => void,
	): () => void
	undo(
		options?: MosaicSubmitOptions,
	): MosaicOperationProposal<MosaicOperation<Model>> | null
}
