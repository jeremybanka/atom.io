import type {
	MosaicAcceptedOperationEnvelope,
	MosaicAtomAddress,
	MosaicSnapshotEnvelope,
} from "atom.io/realtime"
import { mosaicAtomAddressKey } from "atom.io/realtime"

export type MosaicStoredReceipt = {
	/** The operation as it was originally accepted, including server authorship. */
	readonly accepted: MosaicAcceptedOperationEnvelope
	/** A canonical fingerprint of the schema-normalized, authenticated proposal. */
	readonly fingerprint: string
}

/** A durable checkpoint is independent of any requesting client session. */
export type MosaicStoredCheckpoint = Omit<
	MosaicSnapshotEnvelope,
	`acceptedPendingOperationIds` | `session`
>

export type MosaicStorageRecovery = {
	/** The latest durable checkpoint, if one has been created. */
	readonly checkpoint: MosaicStoredCheckpoint | null
	/** Every durable operation after `checkpoint`, in revision order. */
	readonly tail: readonly MosaicAcceptedOperationEnvelope[]
	/** The current durable stream revision. */
	readonly headRevision: number
	/** All accepted ids, including compacted receipts. */
	readonly receiptIds: readonly string[]
	/** Fences concurrent checkpoint/compaction attempts. */
	readonly retentionEpoch: number
}

export type MosaicStorageAppendRequest = {
	readonly accepted: MosaicAcceptedOperationEnvelope
	readonly expectedRevision: number
	readonly fingerprint: string
}

export type MosaicStorageAppendResult =
	| {
			readonly accepted: MosaicAcceptedOperationEnvelope
			readonly status: `accepted`
	  }
	| {
			readonly accepted: MosaicAcceptedOperationEnvelope
			readonly status: `duplicate`
	  }
	| { readonly existing: MosaicStoredReceipt; readonly status: `collision` }
	| { readonly actualRevision: number; readonly status: `stale` }

export type MosaicStorageCheckpointRequest = {
	readonly checkpoint: MosaicStoredCheckpoint
	readonly expectedRevision: number
	readonly expectedRetentionEpoch: number
}

export type MosaicStorageCheckpointResult =
	| {
			readonly compactedThrough: number
			readonly retentionEpoch: number
			readonly status: `stored`
	  }
	| {
			readonly actualRevision: number
			readonly retentionEpoch: number
			readonly status: `stale`
	  }

export type MosaicHeadHint = {
	readonly atom: MosaicAtomAddress
	readonly revision: number
}

export type MosaicStorageResult<Value> = Promise<Value> | Value

/**
 * Linearizable persistence required by a Mosaic server.
 *
 * `append` must atomically enforce both the expected stream revision and the
 * `(atom address, operation id)` uniqueness constraint. A watch notification is
 * only a hint: consumers always recover the authoritative contiguous tail.
 */
export interface MosaicStorageAdapter {
	append(
		request: MosaicStorageAppendRequest,
	): MosaicStorageResult<MosaicStorageAppendResult>
	checkpoint(
		request: MosaicStorageCheckpointRequest,
	): MosaicStorageResult<MosaicStorageCheckpointResult>
	clearSession(
		atom: MosaicAtomAddress,
		session: string,
	): MosaicStorageResult<void>
	recover(atom: MosaicAtomAddress): MosaicStorageResult<MosaicStorageRecovery>
	receipt(
		atom: MosaicAtomAddress,
		operationId: string,
	): MosaicStorageResult<MosaicStoredReceipt | null>
	setSessionWatermark(
		atom: MosaicAtomAddress,
		session: string,
		revision: number,
	): MosaicStorageResult<void>
	watchHead?(
		atom: MosaicAtomAddress,
		listener: (hint: MosaicHeadHint) => void,
	): (() => void) | Promise<() => void>
}

type MemoryAtom = {
	checkpoint: MosaicStoredCheckpoint | null
	headRevision: number
	operations: Map<number, MosaicAcceptedOperationEnvelope>
	receipts: Map<string, MosaicStoredReceipt>
	retentionEpoch: number
	watermarks: Map<string, number>
}

const clone = <Value>(value: Value): Value => structuredClone(value)

const operationIdOf = (accepted: MosaicAcceptedOperationEnvelope): string =>
	accepted.operation.id

/** A restart-safe fixture when the adapter instance itself is retained. */
export class InMemoryMosaicStorage implements MosaicStorageAdapter {
	readonly #atoms = new Map<string, MemoryAtom>()
	readonly #watchers = new Map<string, Set<(hint: MosaicHeadHint) => void>>()

	public append(request: MosaicStorageAppendRequest): MosaicStorageAppendResult {
		const atom = request.accepted.operation.atom
		const atomKey = mosaicAtomAddressKey(atom)
		const state = this.#atom(atom)
		const operationId = operationIdOf(request.accepted)
		const receipt = state.receipts.get(operationId)
		if (receipt !== undefined) {
			if (receipt.fingerprint === request.fingerprint) {
				return { accepted: clone(receipt.accepted), status: `duplicate` }
			}
			return { existing: clone(receipt), status: `collision` }
		}
		if (state.headRevision !== request.expectedRevision) {
			return { actualRevision: state.headRevision, status: `stale` }
		}
		const nextRevision = state.headRevision + 1
		if (request.accepted.revision !== nextRevision) {
			throw new Error(
				`Mosaic append for "${atomKey}" must use revision ${nextRevision}; received ${request.accepted.revision}`,
			)
		}
		const accepted = clone(request.accepted)
		state.operations.set(nextRevision, accepted)
		state.receipts.set(operationId, {
			accepted,
			fingerprint: request.fingerprint,
		})
		state.headRevision = nextRevision
		this.#notify({ atom: clone(atom), revision: nextRevision })
		return { accepted: clone(accepted), status: `accepted` }
	}

	public checkpoint(
		request: MosaicStorageCheckpointRequest,
	): MosaicStorageCheckpointResult {
		const atom = request.checkpoint.atom
		const state = this.#atom(atom)
		if (
			request.expectedRevision !== state.headRevision ||
			request.checkpoint.revision !== state.headRevision ||
			request.expectedRetentionEpoch !== state.retentionEpoch
		) {
			return {
				actualRevision: state.headRevision,
				retentionEpoch: state.retentionEpoch,
				status: `stale`,
			}
		}

		state.checkpoint = clone(request.checkpoint)
		const oldestSession = Math.min(
			request.checkpoint.revision,
			...state.watermarks.values(),
		)
		for (const revision of state.operations.keys()) {
			if (revision <= oldestSession) state.operations.delete(revision)
		}
		state.retentionEpoch++
		return {
			compactedThrough: oldestSession,
			retentionEpoch: state.retentionEpoch,
			status: `stored`,
		}
	}

	public clearSession(atom: MosaicAtomAddress, session: string): void {
		this.#atom(atom).watermarks.delete(session)
	}

	public recover(atom: MosaicAtomAddress): MosaicStorageRecovery {
		const state = this.#atom(atom)
		const checkpoint = state.checkpoint
		const after = checkpoint?.revision ?? 0
		const tail: MosaicAcceptedOperationEnvelope[] = []
		for (let revision = after + 1; revision <= state.headRevision; revision++) {
			const operation = state.operations.get(revision)
			if (operation === undefined) {
				throw new Error(
					`Mosaic storage for "${atom.key}" has a non-contiguous tail: revision ${revision} is missing`,
				)
			}
			tail.push(clone(operation))
		}
		return {
			checkpoint: checkpoint === null ? null : clone(checkpoint),
			headRevision: state.headRevision,
			receiptIds: [...state.receipts.keys()],
			retentionEpoch: state.retentionEpoch,
			tail,
		}
	}

	public receipt(
		atom: MosaicAtomAddress,
		operationId: string,
	): MosaicStoredReceipt | null {
		const receipt = this.#atom(atom).receipts.get(operationId)
		return receipt === undefined ? null : clone(receipt)
	}

	public setSessionWatermark(
		atom: MosaicAtomAddress,
		session: string,
		revision: number,
	): void {
		const state = this.#atom(atom)
		if (!Number.isSafeInteger(revision) || revision < 0) {
			throw new Error(
				`A Mosaic session watermark must be a non-negative integer`,
			)
		}
		state.watermarks.set(
			session,
			Math.max(revision, state.watermarks.get(session) ?? 0),
		)
	}

	public watchHead(
		atom: MosaicAtomAddress,
		listener: (hint: MosaicHeadHint) => void,
	): () => void {
		const key = mosaicAtomAddressKey(atom)
		const listeners = this.#watchers.get(key) ?? new Set()
		listeners.add(listener)
		this.#watchers.set(key, listeners)
		return () => {
			listeners.delete(listener)
			if (listeners.size === 0) this.#watchers.delete(key)
		}
	}

	#notify(hint: MosaicHeadHint): void {
		for (const listener of this.#watchers.get(mosaicAtomAddressKey(hint.atom)) ??
			[]) {
			queueMicrotask(() => {
				listener(hint)
			})
		}
	}

	#atom(atom: MosaicAtomAddress): MemoryAtom {
		const key = mosaicAtomAddressKey(atom)
		let state = this.#atoms.get(key)
		if (state === undefined) {
			state = {
				checkpoint: null,
				headRevision: 0,
				operations: new Map(),
				receipts: new Map(),
				retentionEpoch: 0,
				watermarks: new Map(),
			}
			this.#atoms.set(key, state)
		}
		return state
	}
}
