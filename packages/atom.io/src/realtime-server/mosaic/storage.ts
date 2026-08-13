import type {
	MosaicAcceptedOperationEnvelope,
	MosaicSnapshotEnvelope,
} from "atom.io/realtime"

export type MosaicStoredReceipt = {
	/** The operation as it was originally accepted, including server authorship. */
	readonly accepted: MosaicAcceptedOperationEnvelope
	/** A canonical fingerprint of the schema-normalized, authenticated proposal. */
	readonly fingerprint: string
}

export type MosaicStorageRecovery = {
	/** The latest durable checkpoint, if one has been created. */
	readonly checkpoint: MosaicSnapshotEnvelope | null
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
	readonly checkpoint: MosaicSnapshotEnvelope
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
	readonly resource: string
	readonly revision: number
}

export type MosaicStorageResult<Value> = Promise<Value> | Value

/**
 * Linearizable persistence required by a Mosaic server.
 *
 * `append` must atomically enforce both the expected stream revision and the
 * `(resource, operation id)` uniqueness constraint. A watch notification is
 * only a hint: consumers always recover the authoritative contiguous tail.
 */
export interface MosaicStorageAdapter {
	append(
		request: MosaicStorageAppendRequest,
	): MosaicStorageResult<MosaicStorageAppendResult>
	checkpoint(
		request: MosaicStorageCheckpointRequest,
	): MosaicStorageResult<MosaicStorageCheckpointResult>
	clearSession(resource: string, session: string): MosaicStorageResult<void>
	recover(resource: string): MosaicStorageResult<MosaicStorageRecovery>
	receipt(
		resource: string,
		operationId: string,
	): MosaicStorageResult<MosaicStoredReceipt | null>
	setSessionWatermark(
		resource: string,
		session: string,
		revision: number,
	): MosaicStorageResult<void>
	watchHead?(
		resource: string,
		listener: (hint: MosaicHeadHint) => void,
	): (() => void) | Promise<() => void>
}

type MemoryResource = {
	checkpoint: MosaicSnapshotEnvelope | null
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
	readonly #resources = new Map<string, MemoryResource>()
	readonly #watchers = new Map<string, Set<(hint: MosaicHeadHint) => void>>()

	public append(request: MosaicStorageAppendRequest): MosaicStorageAppendResult {
		const resourceKey = request.accepted.operation.resource
		const resource = this.#resource(resourceKey)
		const operationId = operationIdOf(request.accepted)
		const receipt = resource.receipts.get(operationId)
		if (receipt !== undefined) {
			if (receipt.fingerprint === request.fingerprint) {
				return { accepted: clone(receipt.accepted), status: `duplicate` }
			}
			return { existing: clone(receipt), status: `collision` }
		}
		if (resource.headRevision !== request.expectedRevision) {
			return { actualRevision: resource.headRevision, status: `stale` }
		}
		const nextRevision = resource.headRevision + 1
		if (request.accepted.revision !== nextRevision) {
			throw new Error(
				`Mosaic append for "${resourceKey}" must use revision ${nextRevision}; received ${request.accepted.revision}`,
			)
		}
		const accepted = clone(request.accepted)
		resource.operations.set(nextRevision, accepted)
		resource.receipts.set(operationId, {
			accepted,
			fingerprint: request.fingerprint,
		})
		resource.headRevision = nextRevision
		this.#notify({ resource: resourceKey, revision: nextRevision })
		return { accepted: clone(accepted), status: `accepted` }
	}

	public checkpoint(
		request: MosaicStorageCheckpointRequest,
	): MosaicStorageCheckpointResult {
		const resourceKey = request.checkpoint.resource
		const resource = this.#resource(resourceKey)
		if (
			request.expectedRevision !== resource.headRevision ||
			request.checkpoint.revision !== resource.headRevision ||
			request.expectedRetentionEpoch !== resource.retentionEpoch
		) {
			return {
				actualRevision: resource.headRevision,
				retentionEpoch: resource.retentionEpoch,
				status: `stale`,
			}
		}

		resource.checkpoint = clone(request.checkpoint)
		const oldestSession = Math.min(
			request.checkpoint.revision,
			...resource.watermarks.values(),
		)
		for (const revision of resource.operations.keys()) {
			if (revision <= oldestSession) resource.operations.delete(revision)
		}
		resource.retentionEpoch++
		return {
			compactedThrough: oldestSession,
			retentionEpoch: resource.retentionEpoch,
			status: `stored`,
		}
	}

	public clearSession(resourceKey: string, session: string): void {
		this.#resource(resourceKey).watermarks.delete(session)
	}

	public recover(resourceKey: string): MosaicStorageRecovery {
		const resource = this.#resource(resourceKey)
		const checkpoint = resource.checkpoint
		const after = checkpoint?.revision ?? 0
		const tail: MosaicAcceptedOperationEnvelope[] = []
		for (
			let revision = after + 1;
			revision <= resource.headRevision;
			revision++
		) {
			const operation = resource.operations.get(revision)
			if (operation === undefined) {
				throw new Error(
					`Mosaic storage for "${resourceKey}" has a non-contiguous tail: revision ${revision} is missing`,
				)
			}
			tail.push(clone(operation))
		}
		return {
			checkpoint: checkpoint === null ? null : clone(checkpoint),
			headRevision: resource.headRevision,
			receiptIds: [...resource.receipts.keys()],
			retentionEpoch: resource.retentionEpoch,
			tail,
		}
	}

	public receipt(
		resourceKey: string,
		operationId: string,
	): MosaicStoredReceipt | null {
		const receipt = this.#resource(resourceKey).receipts.get(operationId)
		return receipt === undefined ? null : clone(receipt)
	}

	public setSessionWatermark(
		resourceKey: string,
		session: string,
		revision: number,
	): void {
		const resource = this.#resource(resourceKey)
		if (!Number.isSafeInteger(revision) || revision < 0) {
			throw new Error(
				`A Mosaic session watermark must be a non-negative integer`,
			)
		}
		resource.watermarks.set(
			session,
			Math.max(revision, resource.watermarks.get(session) ?? 0),
		)
	}

	public watchHead(
		resource: string,
		listener: (hint: MosaicHeadHint) => void,
	): () => void {
		const listeners = this.#watchers.get(resource) ?? new Set()
		listeners.add(listener)
		this.#watchers.set(resource, listeners)
		return () => {
			listeners.delete(listener)
			if (listeners.size === 0) this.#watchers.delete(resource)
		}
	}

	#notify(hint: MosaicHeadHint): void {
		for (const listener of this.#watchers.get(hint.resource) ?? []) {
			queueMicrotask(() => {
				listener(hint)
			})
		}
	}

	#resource(key: string): MemoryResource {
		let resource = this.#resources.get(key)
		if (resource === undefined) {
			resource = {
				checkpoint: null,
				headRevision: 0,
				operations: new Map(),
				receipts: new Map(),
				retentionEpoch: 0,
				watermarks: new Map(),
			}
			this.#resources.set(key, resource)
		}
		return resource
	}
}
