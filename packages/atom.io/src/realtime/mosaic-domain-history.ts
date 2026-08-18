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

export const MOSAIC_DOMAIN_HISTORY_EVENTS: Readonly<{
	request: `mosaic-domain-history:request`
	response: `mosaic-domain-history:response`
	snapshot: `mosaic-domain-history:snapshot`
	snapshotResponse: `mosaic-domain-history:snapshot-response`
}> = Object.freeze({
	request: `mosaic-domain-history:request`,
	response: `mosaic-domain-history:response`,
	snapshot: `mosaic-domain-history:snapshot`,
	snapshotResponse: `mosaic-domain-history:snapshot-response`,
})

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
	/** Last accepted request sequence for this authenticated session. */
	readonly sessionSequence: number
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

export type MosaicDomainHistorySocketCommand = Omit<
	MosaicDomainHistoryRequest,
	`session`
>

export type MosaicDomainHistorySocketRequest = {
	readonly command: MosaicDomainHistorySocketCommand
	readonly requestId: string
}

export type MosaicDomainHistorySnapshotSocketRequest = {
	readonly requestId: string
}

export type MosaicDomainHistorySocketError = {
	readonly code: `internal` | `invalid-request`
	readonly reason: string
	readonly retryable: boolean
}

export type MosaicDomainHistorySocketResponse<Value> =
	| { readonly ok: true; readonly requestId: string; readonly value: Value }
	| {
			readonly error: MosaicDomainHistorySocketError
			readonly ok: false
			readonly requestId: string
	  }

const historyIdentifier = (value: unknown): value is string =>
	typeof value === `string` && value.length > 0 && value.length <= 512

const historyRevision = (value: unknown): value is number =>
	Number.isSafeInteger(value) && (value as number) >= 0

/** Fail closed when a transport returns a non-monotonic history projection. */
export function assertMosaicDomainHistorySnapshot(
	value: unknown,
	options: {
		readonly actor?: string
		readonly minimumRevision?: number
	} = {},
): asserts value is MosaicDomainHistorySnapshot {
	if (typeof value !== `object` || value === null) {
		throw new Error(`A Mosaic Domain history snapshot must be an object.`)
	}
	const snapshot = value as Partial<MosaicDomainHistorySnapshot>
	const cursor = snapshot.cursor as
		| Partial<MosaicDomainHistoryCursor>
		| undefined
	const horizon = snapshot.horizon as
		| Partial<MosaicDomainHistoryHorizon>
		| undefined
	const validGestureId = (id: unknown): boolean =>
		id === null || historyIdentifier(id)
	if (
		!historyIdentifier(snapshot.actor) ||
		(options.actor !== undefined && snapshot.actor !== options.actor) ||
		cursor === undefined ||
		!historyRevision(cursor.revision) ||
		!validGestureId(cursor.undoGestureId) ||
		!validGestureId(cursor.redoGestureId) ||
		horizon === undefined ||
		typeof horizon.canUndo !== `boolean` ||
		typeof horizon.canRedo !== `boolean` ||
		!historyRevision(horizon.undoSteps) ||
		!historyRevision(horizon.redoSteps) ||
		!historyRevision(horizon.oldestRetainedRevision) ||
		!historyRevision(horizon.truncatedBeforeRevision) ||
		!historyRevision(snapshot.sessionSequence) ||
		horizon.canUndo !== horizon.undoSteps > 0 ||
		horizon.canRedo !== horizon.redoSteps > 0 ||
		(cursor.undoGestureId === null) !== (horizon.undoSteps === 0) ||
		(cursor.redoGestureId === null) !== (horizon.redoSteps === 0) ||
		horizon.oldestRetainedRevision > cursor.revision ||
		horizon.truncatedBeforeRevision > cursor.revision ||
		(options.minimumRevision !== undefined &&
			cursor.revision < options.minimumRevision)
	) {
		throw new Error(`A Mosaic Domain history snapshot is invalid.`)
	}
}

export function assertMosaicDomainHistoryRequestResult(
	value: unknown,
	options: { readonly actor?: string; readonly minimumRevision?: number } = {},
): asserts value is MosaicDomainHistoryRequestResult {
	if (typeof value !== `object` || value === null || !(`status` in value)) {
		throw new Error(`A Mosaic Domain history result must be an object.`)
	}
	const result = value as Partial<MosaicDomainHistoryRequestResult>
	assertMosaicDomainHistorySnapshot(result.snapshot, options)
	if (result.status === `accepted`) {
		if (
			!historyRevision(result.acceptedRevision) ||
			result.acceptedRevision !== result.snapshot.cursor.revision
		) {
			throw new Error(`A Mosaic Domain history result is invalid.`)
		}
		return
	}
	if (result.status === `unavailable`) return
	if (
		result.status !== `rejected` ||
		!historyIdentifier(result.reason) ||
		!([`domain-resnapshot`, `history-resnapshot`, `retry`] as const).includes(
			result.recovery as never,
		)
	) {
		throw new Error(`A Mosaic Domain history result is invalid.`)
	}
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
