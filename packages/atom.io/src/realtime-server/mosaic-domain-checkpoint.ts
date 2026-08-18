import { createHash, randomUUID } from "node:crypto"

import type { Json } from "atom.io/foundations/json"
import {
	MOSAIC_DOMAIN_CHECKPOINT_PROTOCOL_VERSION,
	type MosaicAcceptedDomainBatchEnvelope,
	type MosaicDomainCheckpointDirectoryNode,
	type MosaicDomainCheckpointIndex,
	type MosaicDomainCheckpointMember,
	type MosaicDomainCheckpointObject,
	type MosaicDomainCheckpointObjectKey,
	type MosaicDomainCheckpointRecovery,
	type MosaicDomainCheckpointRoot,
	type MosaicDomainIdentity,
	type MosaicDomainMemberAddress,
	mosaicDomainMemberAddressKey,
} from "atom.io/realtime"

import {
	mosaicDomainCheckpointObjectKey,
	type MosaicDomainCheckpointStorageAdapter,
	type MosaicDomainCheckpointStoredObject,
} from "./mosaic-domain-checkpoint-storage.ts"

const DIRECTORY_LEAF_SIZE = 16
const HASH_SEGMENTS = 64

export type MosaicDomainCheckpointIndexUpdate = {
	readonly index: string
	readonly path: string
	readonly value: Json.Serializable
}

export type MosaicDomainCheckpointCoordinatorOptions<
	Identity extends MosaicDomainIdentity,
> = {
	readonly domain: Identity
	readonly indexes?: (context: {
		readonly batches: readonly MosaicAcceptedDomainBatchEnvelope<Identity>[]
		readonly fromRevision: number
		readonly revision: number
	}) =>
		| Promise<readonly MosaicDomainCheckpointIndexUpdate[]>
		| readonly MosaicDomainCheckpointIndexUpdate[]
	readonly limits?: {
		readonly maxAttempts?: number
		readonly maxDirtyIndexPaths?: number
		readonly maxDirtyMembers?: number
		readonly maxObjectBytes?: number
		readonly maxRecoveryBatches?: number
	}
	/** Read the named member at exactly the supplied accepted revision. */
	readonly readMember: (context: {
		readonly address: MosaicDomainMemberAddress<Identity>
		readonly revision: number
	}) => Promise<Json.Serializable> | Json.Serializable
	readonly storage: MosaicDomainCheckpointStorageAdapter
}

export type MosaicDomainCheckpointResult = {
	readonly attempts: number
	readonly dirtyIndexPathCount: number
	readonly dirtyMemberCount: number
	readonly persistedBytes: number
	readonly persistedObjectCount: number
	readonly retentionEpoch: number
	readonly revision: number
	readonly rootKey: MosaicDomainCheckpointObjectKey
	readonly status: `checkpointed` | `unchanged`
}

export type MosaicDomainCheckpointCoordinator<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	checkpoint(): Promise<MosaicDomainCheckpointResult>
	readIndex(
		index: string,
		path: string,
	): Promise<MosaicDomainCheckpointIndex | null>
	recover(
		addresses: readonly MosaicDomainMemberAddress<Identity>[],
	): Promise<MosaicDomainCheckpointRecovery<Identity>>
}

const canonicalize = (value: unknown): string => {
	if (value === null || typeof value !== `object`) return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(`,`)}]`
	const object = value as Readonly<Record<string, unknown>>
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
		.join(`,`)}}`
}

const logicalHash = (value: string): string =>
	createHash(`sha256`).update(value).digest(`hex`)

const sameDomain = (
	left: MosaicDomainIdentity,
	right: MosaicDomainIdentity,
): boolean => canonicalize(left) === canonicalize(right)

const assertJson = (value: unknown, maxBytes: number): Json.Serializable => {
	const seen = new WeakSet<object>()
	const pending: unknown[] = [value]
	while (pending.length > 0) {
		const item = pending.pop()
		if (
			item === null ||
			typeof item === `string` ||
			typeof item === `boolean` ||
			(typeof item === `number` && Number.isFinite(item))
		) {
			continue
		}
		if (typeof item !== `object` || seen.has(item)) {
			throw new Error(
				`A Mosaic Domain checkpoint value must be JSON-serializable.`,
			)
		}
		const prototype = Object.getPrototypeOf(item)
		if (
			!Array.isArray(item) &&
			prototype !== null &&
			(prototype as { readonly constructor?: { readonly name?: string } })
				.constructor?.name !== `Object`
		) {
			throw new Error(
				`A Mosaic Domain checkpoint value must be JSON-serializable.`,
			)
		}
		seen.add(item)
		for (const child of Array.isArray(item) ? item : Object.values(item)) {
			pending.push(child)
		}
	}
	const cloned = structuredClone(value) as Json.Serializable
	const bytes = new TextEncoder().encode(JSON.stringify(cloned)).byteLength
	if (bytes > maxBytes) {
		throw new Error(
			`A Mosaic Domain checkpoint object exceeds ${maxBytes} bytes.`,
		)
	}
	return cloned
}

const validName = (value: string): boolean =>
	value.length > 0 && value.length <= 512

/** Coordinate immutable graph construction and atomic root publication. */
export function createMosaicDomainCheckpointCoordinator<
	Identity extends MosaicDomainIdentity,
>(
	options: MosaicDomainCheckpointCoordinatorOptions<Identity>,
): MosaicDomainCheckpointCoordinator<Identity> {
	const maxAttempts = options.limits?.maxAttempts ?? 8
	const maxDirtyIndexPaths = options.limits?.maxDirtyIndexPaths ?? 4096
	const maxDirtyMembers = options.limits?.maxDirtyMembers ?? 4096
	const maxObjectBytes = options.limits?.maxObjectBytes ?? 4 * 1024 * 1024
	const maxRecoveryBatches = options.limits?.maxRecoveryBatches ?? 1024
	for (const [name, value] of [
		[`maxAttempts`, maxAttempts],
		[`maxDirtyIndexPaths`, maxDirtyIndexPaths],
		[`maxDirtyMembers`, maxDirtyMembers],
		[`maxObjectBytes`, maxObjectBytes],
		[`maxRecoveryBatches`, maxRecoveryBatches],
	] as const) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new Error(`${name} must be a positive safe integer.`)
		}
	}

	const readObject = async (
		key: MosaicDomainCheckpointObjectKey,
		staged?: ReadonlyMap<
			MosaicDomainCheckpointObjectKey,
			MosaicDomainCheckpointObject
		>,
	): Promise<MosaicDomainCheckpointObject> => {
		const object =
			staged?.get(key) ??
			(await options.storage.readCheckpointObject(options.domain, key))
		if (object === null || object === undefined) {
			throw new Error(`Mosaic Domain checkpoint object "${key}" is missing.`)
		}
		return object
	}

	const readRoot = async (
		key: MosaicDomainCheckpointObjectKey,
	): Promise<MosaicDomainCheckpointRoot<Identity>> => {
		const root = await readObject(key)
		if (
			root.kind !== `root` ||
			root.protocolVersion !== MOSAIC_DOMAIN_CHECKPOINT_PROTOCOL_VERSION ||
			!sameDomain(root.domain, options.domain) ||
			!Number.isSafeInteger(root.revision) ||
			root.revision < 0 ||
			!Number.isSafeInteger(root.retentionEpoch) ||
			root.retentionEpoch < 1
		) {
			throw new Error(`A Mosaic Domain checkpoint root is invalid.`)
		}
		return root as MosaicDomainCheckpointRoot<Identity>
	}

	const put = (
		object: MosaicDomainCheckpointObject,
		staged: Map<MosaicDomainCheckpointObjectKey, MosaicDomainCheckpointObject>,
	): MosaicDomainCheckpointObjectKey => {
		assertJson(object, maxObjectBytes)
		const key = mosaicDomainCheckpointObjectKey(object)
		staged.set(key, object)
		return key
	}

	const buildDirectory = (
		depth: number,
		entries: readonly {
			readonly key: string
			readonly value: MosaicDomainCheckpointObjectKey
		}[],
		staged: Map<MosaicDomainCheckpointObjectKey, MosaicDomainCheckpointObject>,
	): MosaicDomainCheckpointObjectKey => {
		const sorted = [...entries].sort((left, right) =>
			left.key.localeCompare(right.key),
		)
		if (sorted.length <= DIRECTORY_LEAF_SIZE || depth >= HASH_SEGMENTS) {
			if (sorted.length > DIRECTORY_LEAF_SIZE) {
				throw new Error(`A Mosaic Domain checkpoint directory hash collided.`)
			}
			return put({ depth, entries: sorted, kind: `directory-leaf` }, staged)
		}
		const groups = new Map<string, typeof sorted>()
		for (const entry of sorted) {
			const segment = logicalHash(entry.key)[depth]
			const group = groups.get(segment)
			if (group === undefined) groups.set(segment, [entry])
			else group.push(entry)
		}
		const children = [...groups]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([segment, group]) => ({
				segment,
				value: buildDirectory(depth + 1, group, staged),
			}))
		return put({ children, depth, kind: `directory-branch` }, staged)
	}

	const updateDirectory = async (
		rootKey: MosaicDomainCheckpointObjectKey | null,
		logicalKey: string,
		value: MosaicDomainCheckpointObjectKey,
		staged: Map<MosaicDomainCheckpointObjectKey, MosaicDomainCheckpointObject>,
	): Promise<MosaicDomainCheckpointObjectKey> => {
		const update = async (
			key: MosaicDomainCheckpointObjectKey,
		): Promise<MosaicDomainCheckpointObjectKey> => {
			const node = await readObject(key, staged)
			if (node.kind === `directory-leaf`) {
				const entries = node.entries.filter((entry) => entry.key !== logicalKey)
				entries.push({ key: logicalKey, value })
				return buildDirectory(node.depth, entries, staged)
			}
			if (node.kind !== `directory-branch`) {
				throw new Error(`A Mosaic Domain checkpoint directory is invalid.`)
			}
			const segment = logicalHash(logicalKey)[node.depth]
			const child = node.children.find(
				(candidate) => candidate.segment === segment,
			)
			const next =
				child === undefined
					? buildDirectory(node.depth + 1, [{ key: logicalKey, value }], staged)
					: await update(child.value)
			const children = node.children
				.filter((candidate) => candidate.segment !== segment)
				.concat({ segment, value: next })
				.sort((left, right) => left.segment.localeCompare(right.segment))
			return put(
				{ children, depth: node.depth, kind: `directory-branch` },
				staged,
			)
		}
		return rootKey === null
			? buildDirectory(0, [{ key: logicalKey, value }], staged)
			: update(rootKey)
	}

	const directoryValue = async (
		rootKey: MosaicDomainCheckpointObjectKey | null,
		logicalKey: string,
	): Promise<MosaicDomainCheckpointObjectKey | null> => {
		let key = rootKey
		while (key !== null) {
			const node = await readObject(key)
			if (node.kind === `directory-leaf`) {
				return (
					node.entries.find((entry) => entry.key === logicalKey)?.value ?? null
				)
			}
			if (node.kind !== `directory-branch`) {
				throw new Error(`A Mosaic Domain checkpoint directory is invalid.`)
			}
			const segment = logicalHash(logicalKey)[node.depth]
			key =
				node.children.find((candidate) => candidate.segment === segment)
					?.value ?? null
		}
		return null
	}

	const checkpoint = async (): Promise<MosaicDomainCheckpointResult> => {
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const leaseId = `checkpoint:${randomUUID()}`
			const head = await options.storage.openCheckpointRead(
				options.domain,
				leaseId,
			)
			let leaseActive = true
			try {
				const previous =
					head.rootKey === null ? null : await readRoot(head.rootKey)
				const fromRevision = previous?.revision ?? 0
				const tail = await options.storage.readCheckpointTail(
					options.domain,
					fromRevision,
					head.headRevision,
				)
				const recovery = { headRevision: head.headRevision, tail }
				if (recovery.tail.length > maxRecoveryBatches) {
					throw new Error(
						`Mosaic Domain checkpoint tail exceeds ${maxRecoveryBatches} batches.`,
					)
				}
				if (previous !== null && recovery.headRevision === previous.revision) {
					const retentionEpoch =
						await options.storage.deleteCheckpointRetentionLease(
							options.domain,
							leaseId,
						)
					leaseActive = false
					return {
						attempts: attempt,
						dirtyIndexPathCount: 0,
						dirtyMemberCount: 0,
						persistedBytes: 0,
						persistedObjectCount: 0,
						retentionEpoch,
						revision: previous.revision,
						rootKey: head.rootKey!,
						status: `unchanged`,
					}
				}
				const dirty = new Map<string, MosaicDomainMemberAddress<Identity>>()
				for (const accepted of recovery.tail) {
					for (const address of accepted.batch.affectedMembers) {
						dirty.set(
							mosaicDomainMemberAddressKey(address),
							address as MosaicDomainMemberAddress<Identity>,
						)
					}
				}
				if (dirty.size > maxDirtyMembers) {
					throw new Error(
						`Mosaic Domain dirty checkpoint members exceed ${maxDirtyMembers}.`,
					)
				}
				const updates =
					(await options.indexes?.({
						batches: structuredClone(
							recovery.tail,
						) as MosaicAcceptedDomainBatchEnvelope<Identity>[],
						fromRevision,
						revision: recovery.headRevision,
					})) ?? []
				if (!Array.isArray(updates) || updates.length > maxDirtyIndexPaths) {
					throw new Error(
						`Mosaic Domain dirty checkpoint index paths exceed ${maxDirtyIndexPaths}.`,
					)
				}
				const uniqueIndexes = new Set<string>()
				for (const update of updates) {
					const key = canonicalize([update?.index, update?.path])
					if (
						!validName(update?.index) ||
						!validName(update?.path) ||
						uniqueIndexes.has(key)
					) {
						throw new Error(
							`A Mosaic Domain checkpoint index update is invalid.`,
						)
					}
					uniqueIndexes.add(key)
				}

				const staged = new Map<
					MosaicDomainCheckpointObjectKey,
					MosaicDomainCheckpointObject
				>()
				let memberDirectory = previous?.memberDirectory ?? null
				for (const [logicalKey, address] of dirty) {
					const value = assertJson(
						await options.readMember({
							address: structuredClone(address),
							revision: recovery.headRevision,
						}),
						maxObjectBytes,
					)
					const member: MosaicDomainCheckpointMember<Identity> = {
						address: structuredClone(address),
						kind: `member`,
						revision: recovery.headRevision,
						value,
					}
					memberDirectory = await updateDirectory(
						memberDirectory,
						logicalKey,
						put(member, staged),
						staged,
					)
				}
				let indexDirectory = previous?.indexDirectory ?? null
				for (const update of updates) {
					const index: MosaicDomainCheckpointIndex = {
						index: update.index,
						kind: `index`,
						path: update.path,
						revision: recovery.headRevision,
						value: assertJson(update.value, maxObjectBytes),
					}
					indexDirectory = await updateDirectory(
						indexDirectory,
						canonicalize([update.index, update.path]),
						put(index, staged),
						staged,
					)
				}
				const root: MosaicDomainCheckpointRoot<Identity> = {
					domain: structuredClone(options.domain),
					indexDirectory,
					kind: `root`,
					memberDirectory,
					protocolVersion: MOSAIC_DOMAIN_CHECKPOINT_PROTOCOL_VERSION,
					retentionEpoch: head.retentionEpoch + 1,
					revision: recovery.headRevision,
				}
				const rootKey = put(root, staged)
				const stage = await options.storage.stageCheckpointObjects(
					options.domain,
					[...staged].map(([key, value]) => ({ key, value })),
				)
				const committed = await options.storage.commitCheckpoint({
					domain: options.domain,
					expectedRetentionEpoch: head.retentionEpoch,
					expectedRevision: recovery.headRevision,
					expectedRootKey: head.rootKey,
					rootKey,
				})
				if (committed.status === `stale`) {
					await options.storage.deleteCheckpointRetentionLease(
						options.domain,
						leaseId,
					)
					leaseActive = false
					continue
				}
				const retentionEpoch =
					await options.storage.deleteCheckpointRetentionLease(
						options.domain,
						leaseId,
					)
				leaseActive = false
				return {
					attempts: attempt,
					dirtyIndexPathCount: updates.length,
					dirtyMemberCount: dirty.size,
					persistedBytes: stage.persistedBytes,
					persistedObjectCount: stage.persistedObjectCount,
					retentionEpoch,
					revision: recovery.headRevision,
					rootKey,
					status: `checkpointed`,
				}
			} finally {
				if (leaseActive) {
					await options.storage.deleteCheckpointRetentionLease(
						options.domain,
						leaseId,
					)
				}
			}
		}
		throw new Error(
			`Mosaic Domain checkpoint could not stabilize after ${maxAttempts} attempts.`,
		)
	}

	const recover = async (
		addresses: readonly MosaicDomainMemberAddress<Identity>[],
	): Promise<MosaicDomainCheckpointRecovery<Identity>> => {
		if (!Array.isArray(addresses) || addresses.length > maxDirtyMembers) {
			throw new Error(`Mosaic Domain checkpoint recovery members are invalid.`)
		}
		const leaseId = `recovery:${randomUUID()}`
		const head = await options.storage.openCheckpointRead(
			options.domain,
			leaseId,
		)
		try {
			if (head.rootKey === null) {
				throw new Error(`This Mosaic Domain has no checkpoint.`)
			}
			const root = await readRoot(head.rootKey)
			const seen = new Set<string>()
			const members: MosaicDomainCheckpointMember<Identity>[] = []
			for (const address of addresses) {
				const logicalKey = mosaicDomainMemberAddressKey(address)
				if (seen.has(logicalKey)) {
					throw new Error(`Mosaic Domain recovery addresses must be unique.`)
				}
				seen.add(logicalKey)
				const key = await directoryValue(root.memberDirectory, logicalKey)
				if (key === null) continue
				const member = await readObject(key)
				if (
					member.kind !== `member` ||
					mosaicDomainMemberAddressKey(member.address) !== logicalKey ||
					member.revision > root.revision
				) {
					throw new Error(`A Mosaic Domain checkpoint member is invalid.`)
				}
				members.push(member as MosaicDomainCheckpointMember<Identity>)
			}
			const tail = await options.storage.readCheckpointTail(
				options.domain,
				root.revision,
				head.headRevision,
			)
			if (tail.length > maxRecoveryBatches) {
				throw new Error(
					`Mosaic Domain recovery tail exceeds ${maxRecoveryBatches} batches.`,
				)
			}
			return {
				headRevision: head.headRevision,
				members,
				root,
				rootKey: head.rootKey,
				tail: tail as MosaicAcceptedDomainBatchEnvelope<Identity>[],
			}
		} finally {
			await options.storage.deleteCheckpointRetentionLease(
				options.domain,
				leaseId,
			)
		}
	}

	const readIndex = async (
		index: string,
		path: string,
	): Promise<MosaicDomainCheckpointIndex | null> => {
		if (!validName(index) || !validName(path)) {
			throw new Error(`A Mosaic Domain checkpoint index address is invalid.`)
		}
		const leaseId = `index:${randomUUID()}`
		const head = await options.storage.openCheckpointRead(
			options.domain,
			leaseId,
		)
		try {
			if (head.rootKey === null) return null
			const root = await readRoot(head.rootKey)
			const key = await directoryValue(
				root.indexDirectory,
				canonicalize([index, path]),
			)
			if (key === null) return null
			const value = await readObject(key)
			if (
				value.kind !== `index` ||
				value.index !== index ||
				value.path !== path
			) {
				throw new Error(`A Mosaic Domain checkpoint index is invalid.`)
			}
			return value
		} finally {
			await options.storage.deleteCheckpointRetentionLease(
				options.domain,
				leaseId,
			)
		}
	}

	return { checkpoint, readIndex, recover }
}
