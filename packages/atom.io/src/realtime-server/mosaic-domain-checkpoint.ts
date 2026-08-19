import { createHash, randomUUID } from "node:crypto"

import type { Json } from "atom.io/foundations/json"
import {
	MOSAIC_DOMAIN_CHECKPOINT_PROTOCOL_VERSION,
	type MosaicAcceptedDomainBatchEnvelope,
	type MosaicDomainCheckpointDirectoryNode,
	type MosaicDomainCheckpointExternalRoot,
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
	type MosaicDomainCheckpointStageProposal,
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
	readonly externalRoots?: (context: {
		readonly batches: readonly MosaicAcceptedDomainBatchEnvelope<Identity>[]
		readonly fromRevision: number
		readonly revision: number
	}) =>
		| Promise<readonly MosaicDomainCheckpointObjectKey[]>
		| readonly MosaicDomainCheckpointObjectKey[]
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
		readonly maxExternalBytes?: number
		readonly maxExternalDepth?: number
		readonly maxExternalReads?: number
		readonly maxExternalRoots?: number
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

/** Bounded reads from model-owned roots published by a Domain checkpoint. */
export type MosaicDomainExternalCheckpointReader = {
	readExternalIndexes(
		rootKey: MosaicDomainCheckpointObjectKey,
		addresses: readonly {
			readonly index: string
			readonly path: string
		}[],
	): Promise<readonly MosaicDomainCheckpointIndex[]>
}

export type MosaicDomainExternalCheckpointGraphUpdate =
	| {
			readonly index: string
			readonly path: string
			readonly remove: true
	  }
	| {
			readonly index: string
			readonly path: string
			readonly value: Json.Serializable
	  }

export type MosaicDomainExternalCheckpointGraphResult = {
	readonly bytes: number
	readonly depth: number
	readonly persistedBytes: number
	readonly persistedObjectCount: number
	readonly rootKey: MosaicDomainCheckpointObjectKey
}

export type MosaicDomainExternalCheckpointGraphOptions<
	Identity extends MosaicDomainIdentity,
> = {
	readonly baseRevision: number
	readonly domain: Identity
	readonly limits?:
		| {
				readonly maxBytes?: number
				readonly maxObjectBytes?: number
				readonly maxUpdates?: number
		  }
		| undefined
	readonly previousRootKey?: MosaicDomainCheckpointObjectKey
	readonly proposal?: Omit<MosaicDomainCheckpointStageProposal, `rootKey`>
	readonly storage: MosaicDomainCheckpointStorageAdapter
	readonly updates: readonly MosaicDomainExternalCheckpointGraphUpdate[]
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

const validObjectKey = (
	value: unknown,
): value is MosaicDomainCheckpointObjectKey =>
	typeof value === `string` && /^sha256:[\da-f]{64}$/.test(value)

const jsonBytes = (value: Json.Serializable): number =>
	new TextEncoder().encode(JSON.stringify(value)).byteLength

const assertPositiveLimit = (name: string, value: number): void => {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive safe integer.`)
	}
}

const assertExternalRoot = <Identity extends MosaicDomainIdentity>(
	value: MosaicDomainCheckpointObject,
	domain: Identity,
	limits: {
		readonly maxBytes: number
		readonly maxDepth: number
		readonly revision: number
	},
): MosaicDomainCheckpointExternalRoot<Identity> => {
	if (
		value.kind !== `external-root` ||
		!sameDomain(value.domain, domain) ||
		!Number.isSafeInteger(value.baseRevision) ||
		value.baseRevision < 0 ||
		value.baseRevision > limits.revision ||
		!Number.isSafeInteger(value.depth) ||
		value.depth < 0 ||
		value.depth > limits.maxDepth ||
		!Number.isSafeInteger(value.bytes) ||
		value.bytes < 0 ||
		value.bytes > limits.maxBytes ||
		(value.directory !== null && !validObjectKey(value.directory)) ||
		(value.proof !== undefined && !validObjectKey(value.proof))
	) {
		throw new Error(`A Mosaic Domain external checkpoint root is invalid.`)
	}
	return value as MosaicDomainCheckpointExternalRoot<Identity>
}

const assertDirectoryNode = (
	value: MosaicDomainCheckpointObject,
): MosaicDomainCheckpointDirectoryNode => {
	if (
		value.kind === `directory-leaf` &&
		Number.isSafeInteger(value.depth) &&
		value.depth >= 0 &&
		value.depth <= HASH_SEGMENTS &&
		Array.isArray(value.entries) &&
		value.entries.length <= DIRECTORY_LEAF_SIZE &&
		value.entries.every(
			(entry) =>
				typeof entry.key === `string` &&
				entry.key.length > 0 &&
				entry.key.length <= 2048 &&
				validObjectKey(entry.value),
		) &&
		new Set(value.entries.map(({ key }) => key)).size === value.entries.length
	) {
		return value
	}
	if (
		value.kind === `directory-branch` &&
		Number.isSafeInteger(value.depth) &&
		value.depth >= 0 &&
		value.depth < HASH_SEGMENTS &&
		Array.isArray(value.children) &&
		value.children.length > 0 &&
		value.children.length <= 16 &&
		value.children.every(
			(child) => /^[\da-f]$/.test(child.segment) && validObjectKey(child.value),
		) &&
		new Set(value.children.map(({ segment }) => segment)).size ===
			value.children.length
	) {
		return value
	}
	throw new Error(`A Mosaic Domain checkpoint directory is invalid.`)
}

const readVerifiedCheckpointObject = async (
	storage: MosaicDomainCheckpointStorageAdapter,
	domain: MosaicDomainIdentity,
	key: MosaicDomainCheckpointObjectKey,
	staged?: ReadonlyMap<
		MosaicDomainCheckpointObjectKey,
		MosaicDomainCheckpointObject
	>,
): Promise<MosaicDomainCheckpointObject> => {
	if (!validObjectKey(key)) {
		throw new Error(`A Mosaic Domain checkpoint object key is invalid.`)
	}
	const object =
		staged?.get(key) ?? (await storage.readCheckpointObject(domain, key))
	if (object === null || object === undefined) {
		throw new Error(`Mosaic Domain checkpoint object "${key}" is missing.`)
	}
	if (mosaicDomainCheckpointObjectKey(object) !== key) {
		throw new Error(`A Mosaic Domain checkpoint content key is invalid.`)
	}
	return object
}

/**
 * Stage a model-owned persistent index graph without publishing it. Until a
 * Domain checkpoint records the returned root key, ordinary GC may reclaim it.
 */
export async function stageMosaicDomainExternalCheckpointGraph<
	Identity extends MosaicDomainIdentity,
>(
	options: MosaicDomainExternalCheckpointGraphOptions<Identity>,
): Promise<MosaicDomainExternalCheckpointGraphResult> {
	const maxBytes = options.limits?.maxBytes ?? 1024 * 1024 * 1024
	const maxObjectBytes = options.limits?.maxObjectBytes ?? 4 * 1024 * 1024
	const maxUpdates = options.limits?.maxUpdates ?? 4096
	assertPositiveLimit(`maxBytes`, maxBytes)
	assertPositiveLimit(`maxObjectBytes`, maxObjectBytes)
	assertPositiveLimit(`maxUpdates`, maxUpdates)
	if (!Number.isSafeInteger(options.baseRevision) || options.baseRevision < 0) {
		throw new Error(
			`A Mosaic Domain external checkpoint base revision is invalid.`,
		)
	}
	if (!Array.isArray(options.updates) || options.updates.length > maxUpdates) {
		throw new Error(
			`Mosaic Domain external checkpoint updates exceed ${maxUpdates}.`,
		)
	}

	const staged = new Map<
		MosaicDomainCheckpointObjectKey,
		MosaicDomainCheckpointObject
	>()
	const readObject = (key: MosaicDomainCheckpointObjectKey) =>
		readVerifiedCheckpointObject(options.storage, options.domain, key, staged)
	const put = (
		object: MosaicDomainCheckpointObject,
	): MosaicDomainCheckpointObjectKey => {
		assertJson(object, maxObjectBytes)
		const key = mosaicDomainCheckpointObjectKey(object)
		staged.set(key, object)
		return key
	}
	let maximumDepth = 0
	const buildDirectory = (
		depth: number,
		entries: readonly {
			readonly key: string
			readonly value: MosaicDomainCheckpointObjectKey
		}[],
	): MosaicDomainCheckpointObjectKey => {
		maximumDepth = Math.max(maximumDepth, depth)
		const sorted = [...entries].sort((left, right) =>
			left.key.localeCompare(right.key),
		)
		if (sorted.length <= DIRECTORY_LEAF_SIZE || depth >= HASH_SEGMENTS) {
			if (sorted.length > DIRECTORY_LEAF_SIZE) {
				throw new Error(`A Mosaic Domain checkpoint directory hash collided.`)
			}
			return put({ depth, entries: sorted, kind: `directory-leaf` })
		}
		const groups = new Map<string, typeof sorted>()
		for (const entry of sorted) {
			const segment = logicalHash(entry.key)[depth]
			const group = groups.get(segment)
			if (group === undefined) groups.set(segment, [entry])
			else group.push(entry)
		}
		return put({
			children: [...groups]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([segment, group]) => ({
					segment,
					value: buildDirectory(depth + 1, group),
				})),
			depth,
			kind: `directory-branch`,
		})
	}
	const updateDirectory = async (
		rootKey: MosaicDomainCheckpointObjectKey | null,
		logicalKey: string,
		value: MosaicDomainCheckpointObjectKey,
	): Promise<MosaicDomainCheckpointObjectKey> => {
		const update = async (
			key: MosaicDomainCheckpointObjectKey,
		): Promise<MosaicDomainCheckpointObjectKey> => {
			const node = assertDirectoryNode(await readObject(key))
			if (node.kind === `directory-leaf`) {
				maximumDepth = Math.max(maximumDepth, node.depth)
				const entries = node.entries.filter((entry) => entry.key !== logicalKey)
				entries.push({ key: logicalKey, value })
				return buildDirectory(node.depth, entries)
			}
			if (node.kind !== `directory-branch`) {
				throw new Error(`A Mosaic Domain checkpoint directory is invalid.`)
			}
			maximumDepth = Math.max(maximumDepth, node.depth)
			const segment = logicalHash(logicalKey)[node.depth]
			const child = node.children.find(
				(candidate) => candidate.segment === segment,
			)
			const next =
				child === undefined
					? buildDirectory(node.depth + 1, [{ key: logicalKey, value }])
					: await update(child.value)
			return put({
				children: node.children
					.filter((candidate) => candidate.segment !== segment)
					.concat({ segment, value: next })
					.sort((left, right) => left.segment.localeCompare(right.segment)),
				depth: node.depth,
				kind: `directory-branch`,
			})
		}
		return rootKey === null
			? buildDirectory(0, [{ key: logicalKey, value }])
			: update(rootKey)
	}
	const removeDirectory = async (
		rootKey: MosaicDomainCheckpointObjectKey | null,
		logicalKey: string,
	): Promise<MosaicDomainCheckpointObjectKey | null> => {
		if (rootKey === null) return null
		const remove = async (
			key: MosaicDomainCheckpointObjectKey,
		): Promise<MosaicDomainCheckpointObjectKey | null> => {
			const node = assertDirectoryNode(await readObject(key))
			if (node.kind === `directory-leaf`) {
				const entries = node.entries.filter((entry) => entry.key !== logicalKey)
				if (entries.length === node.entries.length) return key
				return entries.length === 0 ? null : put({ ...node, entries })
			}
			const segment = logicalHash(logicalKey)[node.depth]
			const child = node.children.find(
				(candidate) => candidate.segment === segment,
			)
			if (child === undefined) return key
			const next = await remove(child.value)
			const children = node.children
				.filter((candidate) => candidate.segment !== segment)
				.concat(next === null ? [] : [{ segment, value: next }])
				.sort((left, right) => left.segment.localeCompare(right.segment))
			return children.length === 0 ? null : put({ ...node, children })
		}
		return remove(rootKey)
	}
	const directoryValue = async (
		rootKey: MosaicDomainCheckpointObjectKey | null,
		logicalKey: string,
	): Promise<MosaicDomainCheckpointObjectKey | null> => {
		let key = rootKey
		while (key !== null) {
			const node = assertDirectoryNode(await readObject(key))
			if (node.kind === `directory-leaf`) {
				return (
					node.entries.find((entry) => entry.key === logicalKey)?.value ?? null
				)
			}
			if (node.kind !== `directory-branch`) {
				throw new Error(`A Mosaic Domain checkpoint directory is invalid.`)
			}
			key =
				node.children.find(
					(candidate) =>
						candidate.segment === logicalHash(logicalKey)[node.depth],
				)?.value ?? null
		}
		return null
	}

	let bytes = 0
	let directory: MosaicDomainCheckpointObjectKey | null = null
	if (options.previousRootKey !== undefined) {
		const previousObject = await readObject(options.previousRootKey)
		const previous = assertExternalRoot(previousObject, options.domain, {
			maxBytes,
			maxDepth: HASH_SEGMENTS,
			revision: options.baseRevision,
		})
		bytes = previous.bytes
		directory = previous.directory
		maximumDepth = previous.depth
	}
	const unique = new Set<string>()
	const proofUpdates: (
		| { readonly index: string; readonly path: string; readonly remove: true }
		| {
				readonly index: string
				readonly path: string
				readonly valueKey: MosaicDomainCheckpointObjectKey
		  }
	)[] = []
	for (const update of options.updates) {
		const logicalKey = canonicalize([update?.index, update?.path])
		const removing = `remove` in update
		if (
			!validName(update?.index) ||
			!validName(update?.path) ||
			unique.has(logicalKey) ||
			(removing && (update.remove !== true || `value` in update))
		) {
			throw new Error(`A Mosaic Domain external checkpoint update is invalid.`)
		}
		unique.add(logicalKey)
		const previousValueKey = await directoryValue(directory, logicalKey)
		if (previousValueKey !== null) {
			const previousValue = await readObject(previousValueKey)
			if (
				previousValue.kind !== `index` ||
				previousValue.index !== update.index ||
				previousValue.path !== update.path
			) {
				throw new Error(`A Mosaic Domain external checkpoint index is invalid.`)
			}
			bytes -= jsonBytes(previousValue.value)
		}
		if (removing) {
			directory = await removeDirectory(directory, logicalKey)
			proofUpdates.push({
				index: update.index,
				path: update.path,
				remove: true,
			})
			if (bytes < 0) {
				throw new Error(`A Mosaic Domain external checkpoint graph is invalid.`)
			}
			continue
		}
		const value = assertJson(update.value, maxObjectBytes)
		bytes += jsonBytes(value)
		if (bytes > maxBytes) {
			throw new Error(
				`A Mosaic Domain external checkpoint graph exceeds ${maxBytes} bytes.`,
			)
		}
		const index: MosaicDomainCheckpointIndex = {
			index: update.index,
			kind: `index`,
			path: update.path,
			revision: options.baseRevision,
			value,
		}
		const valueKey = put(index)
		directory = await updateDirectory(directory, logicalKey, valueKey)
		proofUpdates.push({ index: update.index, path: update.path, valueKey })
	}
	if (
		directory === null &&
		options.previousRootKey === undefined &&
		options.updates.length === 0
	) {
		throw new Error(`A Mosaic Domain external checkpoint graph is empty.`)
	}
	const proof = put({
		kind: `external-proof`,
		...(options.previousRootKey === undefined
			? {}
			: { previousRootKey: options.previousRootKey }),
		updates: proofUpdates,
	})
	const root: MosaicDomainCheckpointExternalRoot<Identity> = {
		baseRevision: options.baseRevision,
		bytes,
		depth: maximumDepth,
		directory,
		domain: structuredClone(options.domain),
		kind: `external-root`,
		proof,
	}
	const rootKey = put(root)
	const stage = await options.storage.stageCheckpointObjects(
		options.domain,
		[...staged].map(([key, value]) => ({ key, value })),
		options.proposal === undefined
			? undefined
			: {
					externalGraph: {
						...(options.previousRootKey === undefined
							? {}
							: { previousRootKey: options.previousRootKey }),
						rootKey,
						updates: proofUpdates,
					},
					proposal: { ...options.proposal, rootKey },
				},
	)
	return { ...stage, bytes, depth: maximumDepth, rootKey }
}

/** Coordinate immutable graph construction and atomic root publication. */
export function createMosaicDomainCheckpointCoordinator<
	Identity extends MosaicDomainIdentity,
>(
	options: MosaicDomainCheckpointCoordinatorOptions<Identity>,
): MosaicDomainCheckpointCoordinator<Identity> &
	MosaicDomainExternalCheckpointReader {
	const maxAttempts = options.limits?.maxAttempts ?? 8
	const maxDirtyIndexPaths = options.limits?.maxDirtyIndexPaths ?? 4096
	const maxDirtyMembers = options.limits?.maxDirtyMembers ?? 4096
	const maxExternalBytes = options.limits?.maxExternalBytes ?? 1024 * 1024 * 1024
	const maxExternalDepth = options.limits?.maxExternalDepth ?? HASH_SEGMENTS
	const maxExternalReads = options.limits?.maxExternalReads ?? 256
	const maxExternalRoots = options.limits?.maxExternalRoots ?? 64
	const maxObjectBytes = options.limits?.maxObjectBytes ?? 4 * 1024 * 1024
	const maxRecoveryBatches = options.limits?.maxRecoveryBatches ?? 1024
	for (const [name, value] of [
		[`maxAttempts`, maxAttempts],
		[`maxDirtyIndexPaths`, maxDirtyIndexPaths],
		[`maxDirtyMembers`, maxDirtyMembers],
		[`maxExternalBytes`, maxExternalBytes],
		[`maxExternalReads`, maxExternalReads],
		[`maxExternalRoots`, maxExternalRoots],
		[`maxObjectBytes`, maxObjectBytes],
		[`maxRecoveryBatches`, maxRecoveryBatches],
	] as const) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new Error(`${name} must be a positive safe integer.`)
		}
	}
	if (!Number.isSafeInteger(maxExternalDepth) || maxExternalDepth < 0) {
		throw new Error(`maxExternalDepth must be a non-negative safe integer.`)
	}

	const readObject = async (
		key: MosaicDomainCheckpointObjectKey,
		staged?: ReadonlyMap<
			MosaicDomainCheckpointObjectKey,
			MosaicDomainCheckpointObject
		>,
	): Promise<MosaicDomainCheckpointObject> => {
		return readVerifiedCheckpointObject(
			options.storage,
			options.domain,
			key,
			staged,
		)
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
			root.retentionEpoch < 1 ||
			(root.externalRoots !== undefined &&
				(!Array.isArray(root.externalRoots) ||
					root.externalRoots.length > maxExternalRoots ||
					root.externalRoots.some(
						(externalKey) => !validObjectKey(externalKey),
					) ||
					new Set(root.externalRoots).size !== root.externalRoots.length))
		) {
			throw new Error(`A Mosaic Domain checkpoint root is invalid.`)
		}
		const typed = root as MosaicDomainCheckpointRoot<Identity>
		let externalBytes = 0
		for (const externalKey of typed.externalRoots ?? []) {
			const external = assertExternalRoot(
				await readObject(externalKey),
				options.domain,
				{
					maxBytes: maxExternalBytes,
					maxDepth: maxExternalDepth,
					revision: typed.revision,
				},
			)
			externalBytes += external.bytes
			if (externalBytes > maxExternalBytes) {
				throw new Error(
					`Mosaic Domain external checkpoint roots exceed ${maxExternalBytes} bytes.`,
				)
			}
		}
		return typed
	}

	const externalRoot = async (
		key: MosaicDomainCheckpointObjectKey,
		revision: number,
	): Promise<MosaicDomainCheckpointExternalRoot<Identity>> =>
		assertExternalRoot(await readObject(key), options.domain, {
			maxBytes: maxExternalBytes,
			maxDepth: maxExternalDepth,
			revision,
		})

	const externalRootKeys = async (
		context: {
			readonly batches: readonly MosaicAcceptedDomainBatchEnvelope<Identity>[]
			readonly fromRevision: number
			readonly revision: number
		},
		fallback: readonly MosaicDomainCheckpointObjectKey[],
		accepted: readonly MosaicDomainCheckpointObjectKey[] = [],
	): Promise<readonly MosaicDomainCheckpointObjectKey[]> => {
		const received =
			options.externalRoots === undefined
				? fallback
				: await options.externalRoots(context)
		if (!Array.isArray(received) || received.length > maxExternalRoots) {
			throw new Error(
				`Mosaic Domain external checkpoint roots exceed ${maxExternalRoots}.`,
			)
		}
		const unique = new Set<MosaicDomainCheckpointObjectKey>()
		for (const key of received) {
			if (!validObjectKey(key) || unique.has(key)) {
				throw new Error(
					`A Mosaic Domain external checkpoint root key is invalid.`,
				)
			}
			unique.add(key)
		}
		if (!Array.isArray(accepted)) {
			throw new Error(
				`A Mosaic Domain accepted external checkpoint root list is invalid.`,
			)
		}
		for (const key of accepted) {
			if (!validObjectKey(key)) {
				throw new Error(
					`A Mosaic Domain accepted external checkpoint root key is invalid.`,
				)
			}
			unique.add(key)
		}
		if (unique.size > maxExternalRoots) {
			throw new Error(
				`Mosaic Domain external checkpoint roots exceed ${maxExternalRoots}.`,
			)
		}
		let bytes = 0
		for (const key of unique) {
			bytes += (await externalRoot(key, context.revision)).bytes
			if (bytes > maxExternalBytes) {
				throw new Error(
					`Mosaic Domain external checkpoint roots exceed ${maxExternalBytes} bytes.`,
				)
			}
		}
		return [...unique].sort()
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
			const node = assertDirectoryNode(await readObject(key, staged))
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
			const node = assertDirectoryNode(await readObject(key))
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
				const context = {
					batches: structuredClone(
						recovery.tail,
					) as MosaicAcceptedDomainBatchEnvelope<Identity>[],
					fromRevision,
					revision: recovery.headRevision,
				}
				const requestedExternalRoots = await externalRootKeys(
					context,
					previous?.externalRoots ?? [],
					head.acceptedRootKeys ?? [],
				)
				const previousExternalRoots = [...(previous?.externalRoots ?? [])].sort()
				if (
					previous !== null &&
					recovery.headRevision === previous.revision &&
					canonicalize(requestedExternalRoots) ===
						canonicalize(previousExternalRoots)
				) {
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
						batches: structuredClone(context.batches),
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
					externalRoots: requestedExternalRoots,
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

	const readExternalIndexes = async (
		rootKey: MosaicDomainCheckpointObjectKey,
		addresses: readonly {
			readonly index: string
			readonly path: string
		}[],
	): Promise<readonly MosaicDomainCheckpointIndex[]> => {
		if (
			!validObjectKey(rootKey) ||
			!Array.isArray(addresses) ||
			addresses.length > maxExternalReads
		) {
			throw new Error(
				`Mosaic Domain external checkpoint reads exceed ${maxExternalReads}.`,
			)
		}
		const leaseId = `external-index:${randomUUID()}`
		const head = await options.storage.openCheckpointRead(
			options.domain,
			leaseId,
		)
		try {
			if (head.rootKey === null) {
				throw new Error(`This Mosaic Domain has no checkpoint.`)
			}
			const root = await readRoot(head.rootKey)
			if (!(root.externalRoots ?? []).includes(rootKey)) {
				throw new Error(
					`A Mosaic Domain external checkpoint root is not published.`,
				)
			}
			const external = await externalRoot(rootKey, root.revision)
			const seen = new Set<string>()
			const indexes: MosaicDomainCheckpointIndex[] = []
			for (const address of addresses) {
				const logicalKey = canonicalize([address?.index, address?.path])
				if (
					!validName(address?.index) ||
					!validName(address?.path) ||
					seen.has(logicalKey)
				) {
					throw new Error(
						`A Mosaic Domain external checkpoint index address is invalid.`,
					)
				}
				seen.add(logicalKey)
				const key = await directoryValue(external.directory, logicalKey)
				if (key === null) continue
				const value = await readObject(key)
				if (
					value.kind !== `index` ||
					value.index !== address.index ||
					value.path !== address.path ||
					value.revision > external.baseRevision
				) {
					throw new Error(
						`A Mosaic Domain external checkpoint index is invalid.`,
					)
				}
				indexes.push(value)
			}
			return indexes
		} finally {
			await options.storage.deleteCheckpointRetentionLease(
				options.domain,
				leaseId,
			)
		}
	}

	return { checkpoint, readExternalIndexes, readIndex, recover }
}
