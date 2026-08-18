import type { Json } from "atom.io/foundations/json"

import type {
	MosaicDomainIdentity,
	MosaicDomainMemberAddress,
} from "./mosaic-domain.ts"
import type {
	MosaicDomainHistoryTarget,
	MosaicDomainMemberHistoryPolicy,
	MosaicDomainMemberModel,
} from "./mosaic-domain-batch.ts"

export const MOSAIC_DOMAIN_HISTORY_PROTOCOL_VERSION = 1 as const
export const MOSAIC_DOMAIN_HISTORY_CHECKPOINT_INDEX = `mosaic-domain-history`
export const MOSAIC_DOMAIN_HISTORY_CHECKPOINT_PATH = `state`

export type MosaicDomainHistoryMode = `redo` | `undo`

export type MosaicDomainHistoryGestureOperation<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = MosaicDomainHistoryTarget & {
	readonly address: MosaicDomainMemberAddress<Identity>
	readonly model: {
		readonly configuration?: Json.Serializable
		readonly key: string
		readonly version: number
	}
}

export type MosaicDomainHistoryGesture<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly actor: string
	readonly firstRevision: number
	readonly id: string
	readonly lastRevision: number
	readonly operations: readonly MosaicDomainHistoryGestureOperation<Identity>[]
}

export type MosaicDomainActorHistory<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly actor: string
	readonly cursorRevision: number
	readonly redo: readonly MosaicDomainHistoryGesture<Identity>[]
	readonly truncatedBeforeRevision: number
	readonly undo: readonly MosaicDomainHistoryGesture<Identity>[]
}

export type MosaicDomainHistoryCheckpoint<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly actors: readonly MosaicDomainActorHistory<Identity>[]
	readonly headBatchId: string | null
	readonly protocolVersion: typeof MOSAIC_DOMAIN_HISTORY_PROTOCOL_VERSION
	readonly revision: number
	readonly retiredBeforeRevision: number
	readonly sessions: readonly MosaicDomainHistorySessionWatermark[]
}

export type MosaicDomainHistorySessionWatermark = {
	readonly actor: string
	readonly sequence: number
	readonly session: string
}

export type MosaicDomainHistoryCursor = {
	readonly redoGestureId: string | null
	readonly revision: number
	readonly undoGestureId: string | null
}

export type MosaicDomainHistoryHorizon = {
	readonly canRedo: boolean
	readonly canUndo: boolean
	readonly oldestRetainedRevision: number
	readonly redoSteps: number
	readonly truncatedBeforeRevision: number
	readonly undoSteps: number
}

export type MosaicDomainHistorySnapshot = {
	readonly actor: string
	readonly cursor: MosaicDomainHistoryCursor
	readonly horizon: MosaicDomainHistoryHorizon
}

export type MosaicDomainHistoryRequest = {
	readonly cursor: MosaicDomainHistoryCursor
	readonly id: string
	readonly mode: MosaicDomainHistoryMode
	/** Strictly monotonic within one authenticated client session. */
	readonly sequence: number
	readonly session: string
}

export type MosaicDomainHistoryRequestResult =
	| {
			readonly acceptedRevision: number
			readonly snapshot: MosaicDomainHistorySnapshot
			readonly status: `accepted`
	  }
	| {
			readonly reason: string
			readonly recovery: `domain-resnapshot` | `history-resnapshot` | `retry`
			readonly snapshot: MosaicDomainHistorySnapshot
			readonly status: `rejected`
	  }
	| {
			readonly snapshot: MosaicDomainHistorySnapshot
			readonly status: `unavailable`
	  }

export type MosaicDomainHistoryProtection = {
	readonly id: string
	readonly kind:
		| `annotation`
		| `history`
		| `outbox`
		| `presence`
		| `proposal`
		| `session`
	readonly minimumRevision: number
	readonly operationIds?: readonly string[]
	readonly rootKeys?: readonly `sha256:${string}`[]
}

/** Resolve an explicit policy or the policy declared by a transceiver class. */
export function mosaicDomainMemberHistoryPolicy(
	model: MosaicDomainMemberModel,
): MosaicDomainMemberHistoryPolicy | undefined {
	if (model.history !== undefined) return model.history
	if (model.kind !== `transceiver`) return undefined
	return (
		model.class as typeof model.class & {
			readonly domainHistory?: MosaicDomainMemberHistoryPolicy
		}
	).domainHistory
}
