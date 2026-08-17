import type {
	MosaicAcceptedDomainBatchEnvelope,
	MosaicDomainIdentity,
} from "atom.io/realtime"

export type MosaicDomainBatchReceipt = {
	readonly accepted: MosaicAcceptedDomainBatchEnvelope
	readonly fingerprint: string
}

export type MosaicDomainBatchAppendRequest = {
	readonly accepted: MosaicAcceptedDomainBatchEnvelope
	readonly expectedRevision: number
	readonly fingerprint: string
}

export type MosaicDomainBatchAppendResult =
	| {
			readonly accepted: MosaicAcceptedDomainBatchEnvelope
			readonly status: `accepted`
	  }
	| {
			readonly accepted: MosaicAcceptedDomainBatchEnvelope
			readonly status: `duplicate`
	  }
	| {
			readonly collision: `batch` | `operation`
			readonly id: string
			readonly status: `collision`
	  }
	| { readonly actualRevision: number; readonly status: `stale` }

export type MosaicDomainBatchRecovery = {
	readonly headRevision: number
	readonly tail: readonly MosaicAcceptedDomainBatchEnvelope[]
}

export type MosaicDomainBatchStorageResult<Value> = Promise<Value> | Value

/**
 * Linearizable persistence for one atomic Domain stream.
 *
 * `appendBatch` must check the expected revision and reserve the batch ID and
 * every member-operation ID in the same atomic storage operation.
 */
export interface MosaicDomainBatchStorageAdapter {
	appendBatch(
		request: MosaicDomainBatchAppendRequest,
	): MosaicDomainBatchStorageResult<MosaicDomainBatchAppendResult>
	receipt(
		domain: MosaicDomainIdentity,
		batchId: string,
	): MosaicDomainBatchStorageResult<MosaicDomainBatchReceipt | null>
	recover(
		domain: MosaicDomainIdentity,
		afterRevision?: number,
	): MosaicDomainBatchStorageResult<MosaicDomainBatchRecovery>
}

type MemoryDomain = {
	headRevision: number
	operations: Map<string, string>
	receipts: Map<string, MosaicDomainBatchReceipt>
	tail: Map<number, MosaicAcceptedDomainBatchEnvelope>
}

const clone = <Value>(value: Value): Value => structuredClone(value)

const domainKey = (domain: MosaicDomainIdentity): string =>
	JSON.stringify([
		domain.definition.key,
		domain.definition.version,
		domain.instance,
	])

/** In-process reference adapter and storage-conformance fixture. */
export class InMemoryMosaicDomainBatchStorage implements MosaicDomainBatchStorageAdapter {
	readonly #domains = new Map<string, MemoryDomain>()

	public appendBatch(
		request: MosaicDomainBatchAppendRequest,
	): MosaicDomainBatchAppendResult {
		const batch = request.accepted.batch
		const state = this.#domain(batch.domain)
		const receipt = state.receipts.get(batch.id)
		if (receipt !== undefined) {
			return receipt.fingerprint === request.fingerprint
				? { accepted: clone(receipt.accepted), status: `duplicate` }
				: { collision: `batch`, id: batch.id, status: `collision` }
		}
		for (const operation of batch.operations) {
			const owner = state.operations.get(operation.id)
			if (owner !== undefined) {
				return { collision: `operation`, id: operation.id, status: `collision` }
			}
		}
		if (state.headRevision !== request.expectedRevision) {
			return { actualRevision: state.headRevision, status: `stale` }
		}
		const nextRevision = state.headRevision + 1
		if (request.accepted.revision !== nextRevision) {
			throw new Error(
				`Mosaic Domain append must use revision ${nextRevision}; received ${request.accepted.revision}.`,
			)
		}

		// No mutation occurs before every constraint above has passed.
		const accepted = clone(request.accepted)
		state.tail.set(nextRevision, accepted)
		state.receipts.set(batch.id, {
			accepted,
			fingerprint: request.fingerprint,
		})
		for (const operation of batch.operations) {
			state.operations.set(operation.id, batch.id)
		}
		state.headRevision = nextRevision
		return { accepted: clone(accepted), status: `accepted` }
	}

	public receipt(
		domain: MosaicDomainIdentity,
		batchId: string,
	): MosaicDomainBatchReceipt | null {
		const receipt = this.#domain(domain).receipts.get(batchId)
		return receipt === undefined ? null : clone(receipt)
	}

	public recover(
		domain: MosaicDomainIdentity,
		afterRevision = 0,
	): MosaicDomainBatchRecovery {
		if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) {
			throw new Error(`A Mosaic Domain recovery revision must be non-negative.`)
		}
		const state = this.#domain(domain)
		const tail: MosaicAcceptedDomainBatchEnvelope[] = []
		for (
			let revision = afterRevision + 1;
			revision <= state.headRevision;
			revision++
		) {
			const accepted = state.tail.get(revision)
			if (accepted === undefined) {
				throw new Error(
					`Mosaic Domain storage has a non-contiguous tail at revision ${revision}.`,
				)
			}
			tail.push(clone(accepted))
		}
		return { headRevision: state.headRevision, tail }
	}

	#domain(identity: MosaicDomainIdentity): MemoryDomain {
		const key = domainKey(identity)
		let state = this.#domains.get(key)
		if (state === undefined) {
			state = {
				headRevision: 0,
				operations: new Map(),
				receipts: new Map(),
				tail: new Map(),
			}
			this.#domains.set(key, state)
		}
		return state
	}
}
