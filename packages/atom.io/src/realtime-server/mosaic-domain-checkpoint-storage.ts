import { createHash } from "node:crypto"

import type {
	MosaicAcceptedDomainBatchEnvelope,
	MosaicDomainCheckpointObject,
	MosaicDomainCheckpointObjectKey,
	MosaicDomainCheckpointRetentionLease,
	MosaicDomainCheckpointRoot,
	MosaicDomainIdentity,
} from "atom.io/realtime"

import type {
	MosaicDomainBatchAppendRequest,
	MosaicDomainBatchAppendResult,
	MosaicDomainBatchReceipt,
	MosaicDomainBatchRecovery,
	MosaicDomainBatchStorageAdapter,
	MosaicDomainBatchStorageResult,
} from "./mosaic-domain-batch-storage.ts"

export type MosaicDomainCheckpointHead = {
	readonly headRevision: number
	readonly retentionEpoch: number
	readonly rootKey: MosaicDomainCheckpointObjectKey | null
}

export type MosaicDomainCheckpointStoredObject = {
	readonly key: MosaicDomainCheckpointObjectKey
	readonly value: MosaicDomainCheckpointObject
}

export type MosaicDomainCheckpointStageResult = {
	readonly persistedBytes: number
	readonly persistedObjectCount: number
}

export type MosaicDomainCheckpointCommitRequest = {
	readonly domain: MosaicDomainIdentity
	readonly expectedRevision: number
	readonly expectedRetentionEpoch: number
	readonly expectedRootKey: MosaicDomainCheckpointObjectKey | null
	readonly rootKey: MosaicDomainCheckpointObjectKey
}

export type MosaicDomainCheckpointCommitResult =
	| {
			readonly retentionEpoch: number
			readonly rootKey: MosaicDomainCheckpointObjectKey
			readonly status: `committed`
	  }
	| {
			readonly actualRevision: number
			readonly retentionEpoch: number
			readonly rootKey: MosaicDomainCheckpointObjectKey | null
			readonly status: `stale`
	  }

export type MosaicDomainCheckpointObjectPage = {
	readonly cursor: MosaicDomainCheckpointObjectKey | null
	readonly objects: readonly MosaicDomainCheckpointStoredObject[]
}

export type MosaicDomainCheckpointCollectionRequest = {
	readonly domain: MosaicDomainIdentity
	readonly expectedRetentionEpoch: number
}

export type MosaicDomainCheckpointCollectionResult =
	| {
			readonly deletedObjectCount: number
			readonly deletedTailBatchCount: number
			readonly retentionEpoch: number
			readonly status: `collected`
	  }
	| {
			readonly retentionEpoch: number
			readonly status: `stale`
	  }

/**
 * Vendor-neutral atomic stream plus immutable checkpoint-object storage.
 *
 * Staging may be non-atomic: staged objects are unreachable until
 * `commitCheckpoint` atomically publishes a root after checking the stream
 * revision, prior root, and retention epoch. Content-key collisions must fail.
 */
export interface MosaicDomainCheckpointStorageAdapter extends MosaicDomainBatchStorageAdapter {
	checkpointHead(
		domain: MosaicDomainIdentity,
	): MosaicDomainBatchStorageResult<MosaicDomainCheckpointHead>
	collectCheckpointGarbage(
		request: MosaicDomainCheckpointCollectionRequest,
	): MosaicDomainBatchStorageResult<MosaicDomainCheckpointCollectionResult>
	commitCheckpoint(
		request: MosaicDomainCheckpointCommitRequest,
	): MosaicDomainBatchStorageResult<MosaicDomainCheckpointCommitResult>
	deleteCheckpointRetentionLease(
		domain: MosaicDomainIdentity,
		leaseId: string,
	): MosaicDomainBatchStorageResult<number>
	listCheckpointObjects(
		domain: MosaicDomainIdentity,
		options?: {
			readonly after?: MosaicDomainCheckpointObjectKey
			readonly limit?: number
		},
	): MosaicDomainBatchStorageResult<MosaicDomainCheckpointObjectPage>
	/** Atomically capture and protect one root-plus-tail recovery cut. */
	openCheckpointRead(
		domain: MosaicDomainIdentity,
		leaseId: string,
	): MosaicDomainBatchStorageResult<MosaicDomainCheckpointHead>
	readCheckpointObject(
		domain: MosaicDomainIdentity,
		key: MosaicDomainCheckpointObjectKey,
	): MosaicDomainBatchStorageResult<MosaicDomainCheckpointObject | null>
	readCheckpointTail(
		domain: MosaicDomainIdentity,
		afterRevision: number,
		throughRevision: number,
	): MosaicDomainBatchStorageResult<readonly MosaicAcceptedDomainBatchEnvelope[]>
	stageCheckpointObjects(
		domain: MosaicDomainIdentity,
		objects: readonly MosaicDomainCheckpointStoredObject[],
	): MosaicDomainBatchStorageResult<MosaicDomainCheckpointStageResult>
	upsertCheckpointRetentionLease(
		domain: MosaicDomainIdentity,
		lease: MosaicDomainCheckpointRetentionLease,
	): MosaicDomainBatchStorageResult<number>
}

type MemoryDomain = {
	headRevision: number
	objects: Map<MosaicDomainCheckpointObjectKey, MosaicDomainCheckpointObject>
	operations: Map<string, string>
	receipts: Map<string, MosaicDomainBatchReceipt>
	retentionEpoch: number
	retentionLeases: Map<string, MosaicDomainCheckpointRetentionLease>
	rootKey: MosaicDomainCheckpointObjectKey | null
	tail: Map<number, MosaicAcceptedDomainBatchEnvelope>
}

const clone = <Value>(value: Value): Value => structuredClone(value)

const isJsonSafe = (
	value: unknown,
	ancestors: WeakSet<object> = new WeakSet(),
): boolean => {
	if (
		value === null ||
		typeof value === `boolean` ||
		typeof value === `string`
	) {
		return true
	}
	if (typeof value === `number`) return Number.isFinite(value)
	if (typeof value !== `object` || ancestors.has(value)) return false
	const prototype = Object.getPrototypeOf(value) as {
		readonly constructor?: { readonly name?: string }
	} | null
	if (
		!Array.isArray(value) &&
		prototype !== null &&
		prototype.constructor?.name !== `Object`
	) {
		return false
	}
	ancestors.add(value)
	const valid = Object.values(value).every((child) =>
		isJsonSafe(child, ancestors),
	)
	ancestors.delete(value)
	return valid
}

const canonicalize = (value: unknown): string => {
	if (value === null || typeof value !== `object`) {
		return JSON.stringify(value)
	}
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(`,`)}]`
	const object = value as Readonly<Record<string, unknown>>
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
		.join(`,`)}}`
}

/** Compute the canonical content key every checkpoint adapter must enforce. */
export const mosaicDomainCheckpointObjectKey = (
	value: MosaicDomainCheckpointObject,
): MosaicDomainCheckpointObjectKey =>
	`sha256:${createHash(`sha256`).update(canonicalize(value)).digest(`hex`)}`

const same = (left: unknown, right: unknown): boolean =>
	canonicalize(left) === canonicalize(right)

const domainKey = (domain: MosaicDomainIdentity): string =>
	JSON.stringify([
		domain.definition.key,
		domain.definition.version,
		domain.instance,
	])

const assertLease = (lease: MosaicDomainCheckpointRetentionLease): void => {
	if (
		typeof lease?.id !== `string` ||
		lease.id.length === 0 ||
		lease.id.length > 512 ||
		!Number.isSafeInteger(lease.minimumRevision) ||
		lease.minimumRevision < 0 ||
		![`history`, `outbox`, `proposal`, `session`].includes(lease.kind) ||
		(lease.rootKeys !== undefined &&
			(!Array.isArray(lease.rootKeys) ||
				lease.rootKeys.some((key) => typeof key !== `string`)))
	) {
		throw new Error(`A Mosaic Domain checkpoint retention lease is invalid.`)
	}
}

/** Integrated in-process reference adapter used by conformance tests. */
export class InMemoryMosaicDomainCheckpointStorage implements MosaicDomainCheckpointStorageAdapter {
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

	public checkpointHead(
		domain: MosaicDomainIdentity,
	): MosaicDomainCheckpointHead {
		const state = this.#domain(domain)
		return {
			headRevision: state.headRevision,
			retentionEpoch: state.retentionEpoch,
			rootKey: state.rootKey,
		}
	}

	public collectCheckpointGarbage(
		request: MosaicDomainCheckpointCollectionRequest,
	): MosaicDomainCheckpointCollectionResult {
		const state = this.#domain(request.domain)
		if (request.expectedRetentionEpoch !== state.retentionEpoch) {
			return { retentionEpoch: state.retentionEpoch, status: `stale` }
		}
		const root =
			state.rootKey === null
				? null
				: (state.objects.get(state.rootKey) as
						| MosaicDomainCheckpointRoot
						| undefined)
		if (state.rootKey !== null && root?.kind !== `root`) {
			throw new Error(`A Mosaic Domain checkpoint root is missing.`)
		}
		let retainAfter = root?.revision ?? 0
		for (const lease of state.retentionLeases.values()) {
			retainAfter = Math.min(retainAfter, lease.minimumRevision)
			for (const key of lease.rootKeys ?? []) {
				const protectedRoot = state.objects.get(key)
				if (
					protectedRoot?.kind !== `root` ||
					domainKey(protectedRoot.domain) !== domainKey(request.domain)
				) {
					throw new Error(
						`A Mosaic Domain checkpoint retention root is invalid.`,
					)
				}
				retainAfter = Math.min(retainAfter, protectedRoot.revision)
			}
		}
		const live = new Set<MosaicDomainCheckpointObjectKey>()
		const pending = new Set<MosaicDomainCheckpointObjectKey>()
		if (state.rootKey !== null) pending.add(state.rootKey)
		for (const lease of state.retentionLeases.values()) {
			for (const key of lease.rootKeys ?? []) pending.add(key)
		}
		while (pending.size > 0) {
			const key = pending.values().next().value!
			pending.delete(key)
			if (live.has(key)) continue
			const object = state.objects.get(key)
			if (object === undefined) continue
			live.add(key)
			if (object.kind === `root`) {
				if (object.memberDirectory !== null) pending.add(object.memberDirectory)
				if (object.indexDirectory !== null) pending.add(object.indexDirectory)
			} else if (object.kind === `directory-branch`) {
				for (const child of object.children) pending.add(child.value)
			} else if (object.kind === `directory-leaf`) {
				for (const entry of object.entries) pending.add(entry.value)
			}
		}
		let deletedObjectCount = 0
		for (const key of [...state.objects.keys()]) {
			if (live.has(key)) continue
			state.objects.delete(key)
			deletedObjectCount++
		}

		let deletedTailBatchCount = 0
		for (const revision of [...state.tail.keys()]) {
			if (revision > retainAfter) continue
			state.tail.delete(revision)
			deletedTailBatchCount++
		}
		state.retentionEpoch++
		return {
			deletedObjectCount,
			deletedTailBatchCount,
			retentionEpoch: state.retentionEpoch,
			status: `collected`,
		}
	}

	public commitCheckpoint(
		request: MosaicDomainCheckpointCommitRequest,
	): MosaicDomainCheckpointCommitResult {
		const state = this.#domain(request.domain)
		if (
			request.expectedRevision !== state.headRevision ||
			request.expectedRetentionEpoch !== state.retentionEpoch ||
			request.expectedRootKey !== state.rootKey
		) {
			return {
				actualRevision: state.headRevision,
				retentionEpoch: state.retentionEpoch,
				rootKey: state.rootKey,
				status: `stale`,
			}
		}
		const root = state.objects.get(request.rootKey)
		if (
			root?.kind !== `root` ||
			root.revision !== request.expectedRevision ||
			root.retentionEpoch !== state.retentionEpoch + 1 ||
			domainKey(root.domain) !== domainKey(request.domain)
		) {
			throw new Error(`A Mosaic Domain checkpoint root is invalid.`)
		}
		const pending = [request.rootKey]
		const visited = new Set<MosaicDomainCheckpointObjectKey>()
		while (pending.length > 0) {
			const key = pending.pop()!
			if (visited.has(key)) continue
			const object = state.objects.get(key)
			if (object === undefined) {
				throw new Error(`A Mosaic Domain checkpoint object is missing.`)
			}
			visited.add(key)
			if (object.kind === `root`) {
				if (object.memberDirectory !== null) pending.push(object.memberDirectory)
				if (object.indexDirectory !== null) pending.push(object.indexDirectory)
			} else if (object.kind === `directory-branch`) {
				for (const child of object.children) pending.push(child.value)
			} else if (object.kind === `directory-leaf`) {
				for (const entry of object.entries) pending.push(entry.value)
			}
		}
		state.rootKey = request.rootKey
		state.retentionEpoch++
		return {
			retentionEpoch: state.retentionEpoch,
			rootKey: request.rootKey,
			status: `committed`,
		}
	}

	public deleteCheckpointRetentionLease(
		domain: MosaicDomainIdentity,
		leaseId: string,
	): number {
		const state = this.#domain(domain)
		if (!state.retentionLeases.delete(leaseId)) return state.retentionEpoch
		state.retentionEpoch++
		return state.retentionEpoch
	}

	public listCheckpointObjects(
		domain: MosaicDomainIdentity,
		options: {
			readonly after?: MosaicDomainCheckpointObjectKey
			readonly limit?: number
		} = {},
	): MosaicDomainCheckpointObjectPage {
		const limit = options.limit ?? 100
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1024) {
			throw new Error(
				`A checkpoint object page limit must be between 1 and 1024.`,
			)
		}
		const state = this.#domain(domain)
		const keys = [...state.objects.keys()].sort()
		const start =
			options.after === undefined
				? 0
				: keys.findIndex((key) => key > options.after!)
		if (start < 0) return { cursor: null, objects: [] }
		const selected = keys.slice(start, start + limit)
		const cursor = start + limit < keys.length ? selected.at(-1)! : null
		return {
			cursor,
			objects: selected.map((key) => ({
				key,
				value: clone(state.objects.get(key)!),
			})),
		}
	}

	public readCheckpointObject(
		domain: MosaicDomainIdentity,
		key: MosaicDomainCheckpointObjectKey,
	): MosaicDomainCheckpointObject | null {
		const value = this.#domain(domain).objects.get(key)
		return value === undefined ? null : clone(value)
	}

	public openCheckpointRead(
		domain: MosaicDomainIdentity,
		leaseId: string,
	): MosaicDomainCheckpointHead {
		if (
			typeof leaseId !== `string` ||
			leaseId.length === 0 ||
			leaseId.length > 512
		) {
			throw new Error(`A Mosaic Domain checkpoint read lease ID is invalid.`)
		}
		const state = this.#domain(domain)
		if (state.retentionLeases.has(leaseId)) {
			throw new Error(`A Mosaic Domain checkpoint read lease already exists.`)
		}
		const root =
			state.rootKey === null
				? null
				: (state.objects.get(state.rootKey) as
						| MosaicDomainCheckpointRoot
						| undefined)
		if (state.rootKey !== null && root?.kind !== `root`) {
			throw new Error(`A Mosaic Domain checkpoint root is missing.`)
		}
		state.retentionLeases.set(leaseId, {
			id: leaseId,
			kind: `proposal`,
			minimumRevision: root?.revision ?? 0,
			...(state.rootKey === null ? {} : { rootKeys: [state.rootKey] }),
		})
		state.retentionEpoch++
		return {
			headRevision: state.headRevision,
			retentionEpoch: state.retentionEpoch,
			rootKey: state.rootKey,
		}
	}

	public readCheckpointTail(
		domain: MosaicDomainIdentity,
		afterRevision: number,
		throughRevision: number,
	): readonly MosaicAcceptedDomainBatchEnvelope[] {
		if (
			!Number.isSafeInteger(afterRevision) ||
			afterRevision < 0 ||
			!Number.isSafeInteger(throughRevision) ||
			throughRevision < afterRevision
		) {
			throw new Error(`A Mosaic Domain checkpoint tail range is invalid.`)
		}
		const state = this.#domain(domain)
		if (throughRevision > state.headRevision) {
			throw new Error(`A Mosaic Domain checkpoint tail moved beyond its head.`)
		}
		const tail: MosaicAcceptedDomainBatchEnvelope[] = []
		for (
			let revision = afterRevision + 1;
			revision <= throughRevision;
			revision++
		) {
			const accepted = state.tail.get(revision)
			if (accepted === undefined) {
				throw new Error(
					`Mosaic Domain storage has no retained tail at revision ${revision}.`,
				)
			}
			tail.push(clone(accepted))
		}
		return tail
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
					`Mosaic Domain storage has no retained tail at revision ${revision}.`,
				)
			}
			tail.push(clone(accepted))
		}
		return { headRevision: state.headRevision, tail }
	}

	public stageCheckpointObjects(
		domain: MosaicDomainIdentity,
		objects: readonly MosaicDomainCheckpointStoredObject[],
	): MosaicDomainCheckpointStageResult {
		if (!Array.isArray(objects)) {
			throw new Error(`Mosaic Domain checkpoint objects must be an array.`)
		}
		const state = this.#domain(domain)
		let persistedBytes = 0
		let persistedObjectCount = 0
		for (const item of objects) {
			if (
				typeof item?.key !== `string` ||
				!item.key.startsWith(`sha256:`) ||
				!isJsonSafe(item.value)
			) {
				throw new Error(`A Mosaic Domain checkpoint object is invalid.`)
			}
			if (item.key !== mosaicDomainCheckpointObjectKey(item.value)) {
				throw new Error(`A Mosaic Domain checkpoint content key is invalid.`)
			}
			const existing = state.objects.get(item.key)
			if (existing !== undefined) {
				if (!same(existing, item.value)) {
					throw new Error(`A checkpoint content key collided.`)
				}
				continue
			}
			const value = clone(item.value)
			state.objects.set(item.key, value)
			persistedBytes += new TextEncoder().encode(
				JSON.stringify(value),
			).byteLength
			persistedObjectCount++
		}
		return { persistedBytes, persistedObjectCount }
	}

	public upsertCheckpointRetentionLease(
		domain: MosaicDomainIdentity,
		lease: MosaicDomainCheckpointRetentionLease,
	): number {
		assertLease(lease)
		const state = this.#domain(domain)
		for (const key of lease.rootKeys ?? []) {
			const root = state.objects.get(key)
			if (
				root?.kind !== `root` ||
				domainKey(root.domain) !== domainKey(domain)
			) {
				throw new Error(`A Mosaic Domain checkpoint retention root is invalid.`)
			}
		}
		const received = clone(lease)
		const current = state.retentionLeases.get(lease.id)
		if (current !== undefined && same(current, received))
			return state.retentionEpoch
		state.retentionLeases.set(lease.id, received)
		state.retentionEpoch++
		return state.retentionEpoch
	}

	#domain(identity: MosaicDomainIdentity): MemoryDomain {
		const key = domainKey(identity)
		let state = this.#domains.get(key)
		if (state === undefined) {
			state = {
				headRevision: 0,
				objects: new Map(),
				operations: new Map(),
				receipts: new Map(),
				retentionEpoch: 0,
				retentionLeases: new Map(),
				rootKey: null,
				tail: new Map(),
			}
			this.#domains.set(key, state)
		}
		return state
	}
}
