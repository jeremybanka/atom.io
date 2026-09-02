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
	| { readonly actualSequence: number; readonly status: `retired` }
	| { readonly actualSequence: number; readonly status: `sequence-gap` }
	| { readonly status: `session-capacity` }
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
	recentReceiptIds: string[]
	sessionWatermarks: Map<string, number>
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
	readonly #maxRecentReceipts: number
	readonly #maxSessionWatermarks: number

	public constructor(
		options: {
			readonly maxRecentReceipts?: number
			readonly maxSessionWatermarks?: number
		} = {},
	) {
		this.#maxRecentReceipts = options.maxRecentReceipts ?? 4_096
		this.#maxSessionWatermarks = options.maxSessionWatermarks ?? 4_096
		if (
			!Number.isSafeInteger(this.#maxRecentReceipts) ||
			this.#maxRecentReceipts < 1
		) {
			throw new Error(`maxRecentReceipts must be a positive safe integer.`)
		}
		if (
			!Number.isSafeInteger(this.#maxSessionWatermarks) ||
			this.#maxSessionWatermarks < 1
		) {
			throw new Error(`maxSessionWatermarks must be a positive safe integer.`)
		}
	}

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
		const sessionKey = JSON.stringify([batch.actor, batch.session])
		if (
			!state.sessionWatermarks.has(sessionKey) &&
			state.sessionWatermarks.size >= this.#maxSessionWatermarks
		) {
			return { status: `session-capacity` }
		}
		const watermark = state.sessionWatermarks.get(sessionKey) ?? 0
		if (batch.sequence <= watermark) {
			return { actualSequence: watermark, status: `retired` }
		}
		if (batch.sequence !== watermark + 1) {
			return { actualSequence: watermark, status: `sequence-gap` }
		}
		// No mutation occurs before every constraint above has passed.
		const accepted = clone(request.accepted)
		state.tail.set(nextRevision, accepted)
		state.receipts.set(batch.id, {
			accepted,
			fingerprint: request.fingerprint,
		})
		state.recentReceiptIds.push(batch.id)
		state.sessionWatermarks.set(sessionKey, batch.sequence)
		for (const operation of batch.operations) {
			state.operations.set(operation.id, batch.id)
		}
		state.headRevision = nextRevision
		while (state.recentReceiptIds.length > this.#maxRecentReceipts) {
			const retired = state.recentReceiptIds.shift()!
			const retiredReceipt = state.receipts.get(retired)
			state.receipts.delete(retired)
			for (const operation of retiredReceipt?.accepted.batch.operations ?? []) {
				if (state.operations.get(operation.id) === retired) {
					state.operations.delete(operation.id)
				}
			}
		}
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

	public stats(domain: MosaicDomainIdentity): {
		readonly operationReceiptCount: number
		readonly receiptCount: number
		readonly sessionWatermarkCount: number
		readonly tailBatchCount: number
	} {
		const state = this.#domain(domain)
		return {
			operationReceiptCount: state.operations.size,
			receiptCount: state.receipts.size,
			sessionWatermarkCount: state.sessionWatermarks.size,
			tailBatchCount: state.tail.size,
		}
	}

	#domain(identity: MosaicDomainIdentity): MemoryDomain {
		const key = domainKey(identity)
		let state = this.#domains.get(key)
		if (state === undefined) {
			state = {
				headRevision: 0,
				operations: new Map(),
				receipts: new Map(),
				recentReceiptIds: [],
				sessionWatermarks: new Map(),
				tail: new Map(),
			}
			this.#domains.set(key, state)
		}
		return state
	}
}
