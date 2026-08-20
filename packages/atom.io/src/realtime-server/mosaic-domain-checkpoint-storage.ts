import { createHash } from "node:crypto"

import type {
	MosaicAcceptedDomainBatchEnvelope,
	MosaicDomainCheckpointExternalRoot,
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

const encoder = new TextEncoder()
const DEFAULT_EXTERNAL_STAGE_MAX_BYTES = 16 * 1024 * 1024
const DEFAULT_EXTERNAL_STAGE_MAX_OBJECT_BYTES = 4 * 1024 * 1024
const DEFAULT_EXTERNAL_STAGE_MAX_OBJECT_DEPTH = 64
const DEFAULT_EXTERNAL_STAGE_MAX_OBJECT_NODES = 262_144
const DEFAULT_EXTERNAL_STAGE_MAX_OBJECTS = 4_096

const assertPositiveLimit = (name: string, value: number): void => {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive safe integer.`)
	}
}

export type MosaicDomainCheckpointHead = {
	/** Durable external roots accepted after the currently published checkpoint. */
	readonly acceptedRootKeys?: readonly MosaicDomainCheckpointObjectKey[]
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

export type MosaicDomainCheckpointStageProposal = {
	readonly expiresAfterRevision: number
	readonly expiresAt: number
	readonly id: string
	readonly minimumRevision: number
	readonly rootKey: MosaicDomainCheckpointObjectKey
	/** Maximum completed GC generations before an abandoned stage expires. */
	readonly retentionEpochs?: number
}

export type MosaicDomainCheckpointAcceptedProposal = {
	readonly id: string
	readonly rootKey: MosaicDomainCheckpointObjectKey
}

export type MosaicDomainCheckpointBatchAppendRequest =
	MosaicDomainBatchAppendRequest & {
		/**
		 * Proposal roots promoted to durable accepted protection in the same atomic
		 * transaction as this append.
		 */
		readonly checkpointProposals?: readonly MosaicDomainCheckpointAcceptedProposal[]
	}

export type MosaicDomainCheckpointExternalGraphProof = {
	readonly previousRootKey?: MosaicDomainCheckpointObjectKey
	readonly rootKey: MosaicDomainCheckpointObjectKey
	readonly updates: readonly (
		| {
				readonly index: string
				readonly path: string
				readonly remove: true
		  }
		| {
				readonly index: string
				readonly path: string
				readonly valueKey: MosaicDomainCheckpointObjectKey
		  }
	)[]
}

export type MosaicDomainCheckpointStageOptions = {
	readonly externalGraph?: MosaicDomainCheckpointExternalGraphProof
	readonly limits?: {
		/** Absolute `Date.now()` deadline checked between bounded staging units. */
		readonly deadline?: number
		readonly maxObjectBytes?: number
		readonly maxObjectDepth?: number
		readonly maxObjectNodes?: number
		readonly maxStagedBytes?: number
		readonly maxStagedObjects?: number
	}
	/** Atomically protect one of the objects staged by this call. */
	readonly proposal?: MosaicDomainCheckpointStageProposal
	readonly signal?: AbortSignal
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
	appendBatch(
		request: MosaicDomainCheckpointBatchAppendRequest,
	): MosaicDomainBatchStorageResult<MosaicDomainBatchAppendResult>
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
	/**
	 * When `proposal` is supplied, validate and expose every object, its external
	 * graph proof, and the bounded lease atomically. Exact retries are no-ops.
	 */
	stageCheckpointObjects(
		domain: MosaicDomainIdentity,
		objects: readonly MosaicDomainCheckpointStoredObject[],
		options?: MosaicDomainCheckpointStageOptions,
	): MosaicDomainBatchStorageResult<MosaicDomainCheckpointStageResult>
	upsertCheckpointRetentionLease(
		domain: MosaicDomainIdentity,
		lease: MosaicDomainCheckpointRetentionLease,
	): MosaicDomainBatchStorageResult<number>
}

type MemoryDomain = {
	acceptedCheckpointRoots: Map<
		number,
		Map<
			string,
			{
				readonly minimumRevision: number
				readonly rootKey: MosaicDomainCheckpointObjectKey
			}
		>
	>
	externalGraphs: Map<
		MosaicDomainCheckpointObjectKey,
		{ readonly bytes: number; readonly depth: number }
	>
	externalValidationHashedBytes: number
	externalValidationObjectReads: number
	externalValidationSerializedBytes: number
	headRevision: number
	objects: Map<MosaicDomainCheckpointObjectKey, MosaicDomainCheckpointObject>
	operations: Map<string, string>
	receipts: Map<
		string,
		MosaicDomainBatchReceipt & {
			readonly checkpointProposals?: readonly MosaicDomainCheckpointAcceptedProposal[]
		}
	>
	recentReceiptIds: string[]
	retentionEpoch: number
	retentionLeases: Map<string, MosaicDomainCheckpointRetentionLease>
	rootKey: MosaicDomainCheckpointObjectKey | null
	sessionWatermarks: Map<string, number>
	tail: Map<number, MosaicAcceptedDomainBatchEnvelope>
}

const clone = <Value>(value: Value): Value => structuredClone(value)

const jsonStringBytes = (
	value: string,
	maxBytes: number,
	assertActive: () => void,
): number => {
	let bytes = 2
	for (let index = 0; index < value.length; index++) {
		if ((index & 1023) === 0) assertActive()
		const code = value.charCodeAt(index)
		if (code === 0x22 || code === 0x5c) bytes += 2
		else if (
			code === 0x08 ||
			code === 0x09 ||
			code === 0x0a ||
			code === 0x0c ||
			code === 0x0d
		)
			bytes += 2
		else if (code < 0x20) bytes += 6
		else if (code < 0x80) bytes++
		else if (code < 0x800) bytes += 2
		else if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1)
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4
				index++
			} else bytes += 6
		} else if (code >= 0xdc00 && code <= 0xdfff) bytes += 6
		else bytes += 3
		if (bytes > maxBytes) return bytes
	}
	return bytes
}

const inspectJsonSafe = (
	value: unknown,
	maxBytes: number,
	maxDepth = Number.MAX_SAFE_INTEGER,
	maxNodes = Number.MAX_SAFE_INTEGER,
	assertActive: () => void = () => undefined,
): number | null => {
	const ancestors = new WeakSet<object>()
	const pending: (
		| { readonly depth: number; readonly enter: true; readonly value: unknown }
		| { readonly enter: false; readonly value: object }
	)[] = [{ depth: 0, enter: true, value }]
	let bytes = 0
	let nodes = 0
	let scheduledNodes = 1
	const addBytes = (additional: number): void => {
		if (additional > maxBytes - bytes) {
			throw new Error(
				`A Mosaic Domain checkpoint object exceeds ${maxBytes} bytes.`,
			)
		}
		bytes += additional
	}
	const schedule = (depth: number, child: unknown): void => {
		if (nodes + scheduledNodes >= maxNodes) {
			throw new Error(
				`A Mosaic Domain checkpoint object exceeds ${maxNodes} nodes.`,
			)
		}
		pending.push({ depth, enter: true, value: child })
		scheduledNodes++
	}
	while (pending.length > 0) {
		assertActive()
		const frame = pending.pop()!
		if (!frame.enter) {
			ancestors.delete(frame.value)
			continue
		}
		scheduledNodes--
		const item = frame.value
		nodes++
		if (nodes > maxNodes) {
			throw new Error(
				`A Mosaic Domain checkpoint object exceeds ${maxNodes} nodes.`,
			)
		}
		if (frame.depth > maxDepth) {
			throw new Error(
				`A Mosaic Domain checkpoint object exceeds depth ${maxDepth}.`,
			)
		}
		if (
			item === null ||
			typeof item === `boolean` ||
			(typeof item === `number` && Number.isFinite(item))
		) {
			addBytes(JSON.stringify(item).length)
			continue
		}
		if (typeof item === `string`) {
			addBytes(jsonStringBytes(item, maxBytes - bytes, assertActive))
			continue
		}
		if (typeof item !== `object` || ancestors.has(item)) {
			return null
		}
		const prototype = Object.getPrototypeOf(item) as {
			readonly constructor?: { readonly name?: string }
		} | null
		if (
			!Array.isArray(item) &&
			prototype !== null &&
			prototype.constructor?.name !== `Object`
		) {
			return null
		}
		ancestors.add(item)
		pending.push({ enter: false, value: item })
		addBytes(2)
		if (Array.isArray(item)) {
			if (item.length > 0) addBytes(item.length - 1)
			for (let index = item.length - 1; index >= 0; index--) {
				const descriptor = Object.getOwnPropertyDescriptor(item, String(index))
				if (descriptor === undefined || !(`value` in descriptor)) return null
				schedule(frame.depth + 1, descriptor.value)
			}
			continue
		}
		let propertyCount = 0
		for (const key in item) {
			if (!Object.hasOwn(item, key)) continue
			const descriptor = Object.getOwnPropertyDescriptor(item, key)
			if (descriptor?.enumerable !== true) continue
			if (!(`value` in descriptor)) return null
			if (propertyCount > 0) addBytes(1)
			addBytes(jsonStringBytes(key, maxBytes - bytes, assertActive))
			addBytes(1)
			propertyCount++
			schedule(frame.depth + 1, descriptor.value)
		}
	}
	return bytes
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

const validObjectKey = (
	value: unknown,
): value is MosaicDomainCheckpointObjectKey =>
	typeof value === `string` && /^sha256:[\da-f]{64}$/.test(value)

const domainKey = (domain: MosaicDomainIdentity): string =>
	JSON.stringify([
		domain.definition.key,
		domain.definition.version,
		domain.instance,
	])

const assertExternalRoot = (
	value: MosaicDomainCheckpointExternalRoot,
	domain: MosaicDomainIdentity,
	maximumRevision: number,
): void => {
	if (
		domainKey(value.domain) !== domainKey(domain) ||
		!Number.isSafeInteger(value.baseRevision) ||
		value.baseRevision < 0 ||
		value.baseRevision > maximumRevision ||
		!Number.isSafeInteger(value.depth) ||
		value.depth < 0 ||
		value.depth > 64 ||
		!Number.isSafeInteger(value.bytes) ||
		value.bytes < 0 ||
		(value.directory !== null && !validObjectKey(value.directory)) ||
		(value.proof !== undefined && !validObjectKey(value.proof))
	) {
		throw new Error(`A Mosaic Domain external checkpoint root is invalid.`)
	}
}

const assertRootDependencies = (root: MosaicDomainCheckpointRoot): void => {
	if (
		root.externalRoots !== undefined &&
		(!Array.isArray(root.externalRoots) ||
			root.externalRoots.length > 4096 ||
			root.externalRoots.some((key) => !validObjectKey(key)) ||
			new Set(root.externalRoots).size !== root.externalRoots.length)
	) {
		throw new Error(`A Mosaic Domain checkpoint root is invalid.`)
	}
}

const assertDirectoryObject = (
	value: Extract<
		MosaicDomainCheckpointObject,
		{ kind: `directory-branch` | `directory-leaf` }
	>,
): void => {
	if (
		value.kind === `directory-leaf` &&
		Number.isSafeInteger(value.depth) &&
		value.depth >= 0 &&
		value.depth <= 64 &&
		Array.isArray(value.entries) &&
		value.entries.length <= 16 &&
		value.entries.every(
			(entry) =>
				typeof entry.key === `string` &&
				entry.key.length > 0 &&
				entry.key.length <= 2048 &&
				validObjectKey(entry.value),
		) &&
		new Set(value.entries.map(({ key }) => key)).size === value.entries.length
	) {
		return
	}
	if (
		value.kind === `directory-branch` &&
		Number.isSafeInteger(value.depth) &&
		value.depth >= 0 &&
		value.depth < 64 &&
		Array.isArray(value.children) &&
		value.children.length > 0 &&
		value.children.length <= 16 &&
		value.children.every(
			(child) => /^[\da-f]$/.test(child.segment) && validObjectKey(child.value),
		) &&
		new Set(value.children.map(({ segment }) => segment)).size ===
			value.children.length
	) {
		return
	}
	throw new Error(`A Mosaic Domain checkpoint directory is invalid.`)
}

const assertLease = (lease: MosaicDomainCheckpointRetentionLease): void => {
	if (
		typeof lease?.id !== `string` ||
		lease.id.length === 0 ||
		lease.id.length > 512 ||
		(lease.expiresAfterRevision !== undefined &&
			(!Number.isSafeInteger(lease.expiresAfterRevision) ||
				lease.expiresAfterRevision < 0)) ||
		(lease.expiresAt !== undefined &&
			(!Number.isFinite(lease.expiresAt) || lease.expiresAt < 0)) ||
		(lease.expiresAtRetentionEpoch !== undefined &&
			(!Number.isSafeInteger(lease.expiresAtRetentionEpoch) ||
				lease.expiresAtRetentionEpoch < 0)) ||
		!Number.isSafeInteger(lease.minimumRevision) ||
		lease.minimumRevision < 0 ||
		![
			`annotation`,
			`history`,
			`outbox`,
			`presence`,
			`proposal`,
			`session`,
		].includes(lease.kind) ||
		(lease.rootKeys !== undefined &&
			(!Array.isArray(lease.rootKeys) ||
				lease.rootKeys.some((key) => !validObjectKey(key))))
	) {
		throw new Error(`A Mosaic Domain checkpoint retention lease is invalid.`)
	}
}

const acceptedCheckpointProposals = (
	value: readonly MosaicDomainCheckpointAcceptedProposal[] | undefined,
): readonly MosaicDomainCheckpointAcceptedProposal[] => {
	if (value === undefined) return []
	if (
		!Array.isArray(value) ||
		value.length > 64 ||
		value.some(
			(proposal) =>
				typeof proposal?.id !== `string` ||
				proposal.id.length === 0 ||
				proposal.id.length > 512 ||
				!validObjectKey(proposal.rootKey),
		) ||
		new Set(value.map(({ id }) => id)).size !== value.length ||
		new Set(value.map(({ rootKey }) => rootKey)).size !== value.length
	) {
		throw new Error(
			`A Mosaic Domain checkpoint append proposal list is invalid.`,
		)
	}
	return [...value]
		.map((proposal) => clone(proposal))
		.sort((left, right) => left.id.localeCompare(right.id))
}

const leaseExpired = (
	lease: MosaicDomainCheckpointRetentionLease,
	state: Pick<MemoryDomain, `headRevision` | `retentionEpoch`>,
	now: number,
): boolean =>
	(lease.expiresAfterRevision !== undefined &&
		state.headRevision >= lease.expiresAfterRevision) ||
	(lease.expiresAt !== undefined && now >= lease.expiresAt) ||
	(lease.expiresAtRetentionEpoch !== undefined &&
		state.retentionEpoch >= lease.expiresAtRetentionEpoch)

const externalParentProtected = (
	state: MemoryDomain,
	rootKey: MosaicDomainCheckpointObjectKey,
	now: number,
): boolean => {
	const current =
		state.rootKey === null ? null : state.objects.get(state.rootKey)
	if (
		current?.kind === `root` &&
		(current.externalRoots ?? []).includes(rootKey)
	) {
		return true
	}
	for (const lease of state.retentionLeases.values()) {
		if (leaseExpired(lease, state, now)) continue
		for (const key of lease.rootKeys ?? []) {
			if (key === rootKey) return true
			const root = state.objects.get(key)
			if (
				root?.kind === `root` &&
				(root.externalRoots ?? []).includes(rootKey)
			) {
				return true
			}
		}
	}
	return false
}

const verifyExternalGraphProof = (
	state: MemoryDomain,
	domain: MosaicDomainIdentity,
	candidates: ReadonlyMap<
		MosaicDomainCheckpointObjectKey,
		MosaicDomainCheckpointObject
	>,
	proof: MosaicDomainCheckpointExternalGraphProof,
	now: number,
	assertActive: () => void = () => undefined,
): { readonly bytes: number; readonly depth: number } => {
	const read = (
		key: MosaicDomainCheckpointObjectKey,
	): MosaicDomainCheckpointObject => {
		assertActive()
		const object = candidates.get(key) ?? state.objects.get(key)
		if (object === undefined) {
			throw new Error(`A Mosaic Domain external checkpoint object is missing.`)
		}
		const serialized = canonicalize(object)
		state.externalValidationObjectReads++
		state.externalValidationHashedBytes += encoder.encode(serialized).byteLength
		if (
			`sha256:${createHash(`sha256`).update(serialized).digest(`hex`)}` !== key
		) {
			throw new Error(`A Mosaic Domain checkpoint content key is invalid.`)
		}
		assertActive()
		return object
	}
	const rootObject = read(proof.rootKey)
	if (rootObject.kind !== `external-root`) {
		throw new Error(`A Mosaic Domain external checkpoint proof is invalid.`)
	}
	const root = rootObject
	assertExternalRoot(root, domain, Number.MAX_SAFE_INTEGER)
	if (root.proof === undefined) {
		throw new Error(`A Mosaic Domain external checkpoint proof is invalid.`)
	}
	const proofObject = read(root.proof)
	if (
		proofObject.kind !== `external-proof` ||
		!same(proofObject, {
			kind: `external-proof`,
			...(proof.previousRootKey === undefined
				? {}
				: { previousRootKey: proof.previousRootKey }),
			updates: proof.updates,
		})
	) {
		throw new Error(`A Mosaic Domain external checkpoint proof is invalid.`)
	}
	let directory: MosaicDomainCheckpointObjectKey | null = null
	let bytes = 0
	let depth = 0
	if (proof.previousRootKey !== undefined) {
		if (!externalParentProtected(state, proof.previousRootKey, now)) {
			throw new Error(
				`A Mosaic Domain external checkpoint parent is not protected.`,
			)
		}
		const previousObject = read(proof.previousRootKey)
		if (previousObject.kind !== `external-root`) {
			throw new Error(`A Mosaic Domain external checkpoint parent is invalid.`)
		}
		assertExternalRoot(previousObject, domain, root.baseRevision)
		let previous = state.externalGraphs.get(proof.previousRootKey)
		const currentRoot =
			state.rootKey === null ? null : state.objects.get(state.rootKey)
		if (
			previous === undefined &&
			currentRoot?.kind === `root` &&
			(currentRoot.externalRoots ?? []).includes(proof.previousRootKey)
		) {
			previous = {
				bytes: previousObject.bytes,
				depth: previousObject.depth,
			}
			state.externalGraphs.set(proof.previousRootKey, previous)
		}
		if (
			previous === undefined ||
			previous.bytes !== previousObject.bytes ||
			previous.depth !== previousObject.depth ||
			root.baseRevision < previousObject.baseRevision
		) {
			throw new Error(`A Mosaic Domain external checkpoint parent is stale.`)
		}
		directory = previousObject.directory
		bytes = previous.bytes
		depth = previous.depth
	}
	if (!Array.isArray(proof.updates) || proof.updates.length > 4096) {
		throw new Error(`A Mosaic Domain external checkpoint proof is invalid.`)
	}
	const generated = new Map<
		MosaicDomainCheckpointObjectKey,
		MosaicDomainCheckpointObject
	>()
	const logicalKeyHashes = new Map<string, string>()
	const segmentFor = (logicalKey: string, at: number): string => {
		let hash = logicalKeyHashes.get(logicalKey)
		if (hash === undefined) {
			hash = createHash(`sha256`).update(logicalKey).digest(`hex`)
			logicalKeyHashes.set(logicalKey, hash)
		}
		return hash[at]
	}
	const put = (
		object: MosaicDomainCheckpointObject,
	): MosaicDomainCheckpointObjectKey => {
		const key = mosaicDomainCheckpointObjectKey(object)
		generated.set(key, object)
		const stored = read(key)
		if (!same(stored, object)) {
			throw new Error(`A Mosaic Domain external checkpoint proof collided.`)
		}
		return key
	}
	const get = (key: MosaicDomainCheckpointObjectKey) =>
		generated.get(key) ?? read(key)
	const buildDirectory = (
		at: number,
		entries: readonly {
			readonly key: string
			readonly value: MosaicDomainCheckpointObjectKey
		}[],
	): MosaicDomainCheckpointObjectKey => {
		depth = Math.max(depth, at)
		const sorted = [...entries].sort((left, right) =>
			left.key.localeCompare(right.key),
		)
		if (sorted.length <= 16 || at >= 64) {
			if (sorted.length > 16) {
				throw new Error(`A Mosaic Domain checkpoint directory hash collided.`)
			}
			return put({ depth: at, entries: sorted, kind: `directory-leaf` })
		}
		const groups = new Map<string, typeof sorted>()
		for (const entry of sorted) {
			const segment = segmentFor(entry.key, at)
			const group = groups.get(segment)
			if (group === undefined) groups.set(segment, [entry])
			else group.push(entry)
		}
		return put({
			children: [...groups]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([segment, group]) => ({
					segment,
					value: buildDirectory(at + 1, group),
				})),
			depth: at,
			kind: `directory-branch`,
		})
	}
	const directoryValue = (
		rootKey: MosaicDomainCheckpointObjectKey | null,
		logicalKey: string,
	): MosaicDomainCheckpointObjectKey | null => {
		let key = rootKey
		while (key !== null) {
			const node = get(key)
			if (node.kind === `directory-leaf`) {
				assertDirectoryObject(node)
				return (
					node.entries.find((entry) => entry.key === logicalKey)?.value ?? null
				)
			}
			if (node.kind !== `directory-branch`) {
				throw new Error(`A Mosaic Domain checkpoint directory is invalid.`)
			}
			assertDirectoryObject(node)
			const segment = segmentFor(logicalKey, node.depth)
			key =
				node.children.find((child) => child.segment === segment)?.value ?? null
		}
		return null
	}
	const updateDirectory = (
		rootKey: MosaicDomainCheckpointObjectKey | null,
		logicalKey: string,
		value: MosaicDomainCheckpointObjectKey,
	): MosaicDomainCheckpointObjectKey => {
		const update = (
			key: MosaicDomainCheckpointObjectKey,
		): MosaicDomainCheckpointObjectKey => {
			const node = get(key)
			if (node.kind === `directory-leaf`) {
				assertDirectoryObject(node)
				return buildDirectory(
					node.depth,
					node.entries
						.filter((entry) => entry.key !== logicalKey)
						.concat({ key: logicalKey, value }),
				)
			}
			if (node.kind !== `directory-branch`) {
				throw new Error(`A Mosaic Domain checkpoint directory is invalid.`)
			}
			assertDirectoryObject(node)
			const segment = segmentFor(logicalKey, node.depth)
			const child = node.children.find((item) => item.segment === segment)
			const next =
				child === undefined
					? buildDirectory(node.depth + 1, [{ key: logicalKey, value }])
					: update(child.value)
			return put({
				children: node.children
					.filter((item) => item.segment !== segment)
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
	const removeDirectory = (
		rootKey: MosaicDomainCheckpointObjectKey | null,
		logicalKey: string,
	): MosaicDomainCheckpointObjectKey | null => {
		if (rootKey === null) return null
		const remove = (
			key: MosaicDomainCheckpointObjectKey,
		): MosaicDomainCheckpointObjectKey | null => {
			const node = get(key)
			if (node.kind === `directory-leaf`) {
				assertDirectoryObject(node)
				const entries = node.entries.filter((entry) => entry.key !== logicalKey)
				if (entries.length === node.entries.length) return key
				return entries.length === 0 ? null : put({ ...node, entries })
			}
			if (node.kind !== `directory-branch`) {
				throw new Error(`A Mosaic Domain checkpoint directory is invalid.`)
			}
			assertDirectoryObject(node)
			const segment = segmentFor(logicalKey, node.depth)
			const child = node.children.find((item) => item.segment === segment)
			if (child === undefined) return key
			const next = remove(child.value)
			const children = node.children
				.filter((item) => item.segment !== segment)
				.concat(next === null ? [] : [{ segment, value: next }])
				.sort((left, right) => left.segment.localeCompare(right.segment))
			return children.length === 0 ? null : put({ ...node, children })
		}
		return remove(rootKey)
	}
	const seen = new Set<string>()
	for (const update of proof.updates) {
		assertActive()
		const logicalKey = canonicalize([update.index, update.path])
		if (
			seen.has(logicalKey) ||
			typeof update.index !== `string` ||
			update.index.length === 0 ||
			typeof update.path !== `string` ||
			update.path.length === 0
		) {
			throw new Error(`A Mosaic Domain external checkpoint proof is invalid.`)
		}
		seen.add(logicalKey)
		const previousValueKey = directoryValue(directory, logicalKey)
		if (previousValueKey !== null) {
			const previousValue = read(previousValueKey)
			if (
				previousValue.kind !== `index` ||
				previousValue.index !== update.index ||
				previousValue.path !== update.path
			) {
				throw new Error(`A Mosaic Domain external checkpoint proof is invalid.`)
			}
			const serialized = JSON.stringify(previousValue.value)
			const serializedBytes = encoder.encode(serialized).byteLength
			state.externalValidationSerializedBytes += serializedBytes
			bytes -= serializedBytes
		}
		if (`remove` in update) {
			directory = removeDirectory(directory, logicalKey)
			continue
		}
		const value = read(update.valueKey)
		if (
			value.kind !== `index` ||
			value.index !== update.index ||
			value.path !== update.path ||
			value.revision !== root.baseRevision
		) {
			throw new Error(`A Mosaic Domain external checkpoint proof is invalid.`)
		}
		const serialized = JSON.stringify(value.value)
		const serializedBytes = encoder.encode(serialized).byteLength
		state.externalValidationSerializedBytes += serializedBytes
		bytes += serializedBytes
		directory = updateDirectory(directory, logicalKey, update.valueKey)
	}
	if (
		directory !== root.directory ||
		bytes !== root.bytes ||
		depth !== root.depth
	) {
		throw new Error(`A Mosaic Domain external checkpoint summary is invalid.`)
	}
	return { bytes, depth }
}

/** Integrated in-process reference adapter used by conformance tests. */
export class InMemoryMosaicDomainCheckpointStorage implements MosaicDomainCheckpointStorageAdapter {
	#domains = new Map<string, MemoryDomain>()
	readonly #maxRecentReceipts: number
	readonly #maxSessionWatermarks: number
	readonly #now: () => number

	public constructor(
		options: {
			readonly maxRecentReceipts?: number
			readonly maxSessionWatermarks?: number
			readonly now?: () => number
		} = {},
	) {
		this.#maxRecentReceipts = options.maxRecentReceipts ?? 4_096
		this.#maxSessionWatermarks = options.maxSessionWatermarks ?? 4_096
		this.#now = options.now ?? Date.now
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
		request: MosaicDomainCheckpointBatchAppendRequest,
	): MosaicDomainBatchAppendResult {
		const batch = request.accepted.batch
		const state = this.#domain(batch.domain)
		const checkpointProposals = acceptedCheckpointProposals(
			request.checkpointProposals,
		)
		const receipt = state.receipts.get(batch.id)
		if (receipt !== undefined) {
			return receipt.fingerprint === request.fingerprint &&
				same(receipt.checkpointProposals ?? [], checkpointProposals)
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
		const acceptedRoots = new Map<
			string,
			{
				readonly minimumRevision: number
				readonly rootKey: MosaicDomainCheckpointObjectKey
			}
		>()
		for (const proposal of checkpointProposals) {
			const lease = state.retentionLeases.get(proposal.id)
			const root = state.objects.get(proposal.rootKey)
			if (
				lease === undefined ||
				lease.kind !== `proposal` ||
				leaseExpired(lease, state, this.#now()) ||
				lease.expiresAfterRevision !== nextRevision ||
				!same(lease.rootKeys, [proposal.rootKey]) ||
				root?.kind !== `external-root` ||
				root.baseRevision !== nextRevision ||
				domainKey(root.domain) !== domainKey(batch.domain)
			) {
				throw new Error(`A Mosaic Domain checkpoint append proposal is invalid.`)
			}
			acceptedRoots.set(proposal.id, {
				minimumRevision: lease.minimumRevision,
				rootKey: proposal.rootKey,
			})
		}
		const accepted = clone(request.accepted)
		state.tail.set(nextRevision, accepted)
		state.receipts.set(batch.id, {
			accepted,
			...(checkpointProposals.length === 0 ? {} : { checkpointProposals }),
			fingerprint: request.fingerprint,
		})
		state.recentReceiptIds.push(batch.id)
		state.sessionWatermarks.set(sessionKey, batch.sequence)
		for (const operation of batch.operations) {
			state.operations.set(operation.id, batch.id)
		}
		if (acceptedRoots.size > 0) {
			state.acceptedCheckpointRoots.set(nextRevision, acceptedRoots)
			for (const proposal of checkpointProposals) {
				state.retentionLeases.delete(proposal.id)
			}
			// Promotion changes the GC root set and fences an in-flight collection.
			state.retentionEpoch++
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

	public checkpointHead(
		domain: MosaicDomainIdentity,
	): MosaicDomainCheckpointHead {
		const state = this.#domain(domain)
		return {
			acceptedRootKeys: [
				...new Set(
					[...state.acceptedCheckpointRoots.values()].flatMap((proposals) =>
						[...proposals.values()].map(({ rootKey }) => rootKey),
					),
				),
			].sort(),
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
		const activeLeases = [...state.retentionLeases.values()].filter(
			(lease) => !leaseExpired(lease, state, this.#now()),
		)
		const acceptedRoots = [...state.acceptedCheckpointRoots.values()].flatMap(
			(proposals) => [...proposals.values()],
		)
		const root =
			state.rootKey === null
				? null
				: (state.objects.get(state.rootKey) as
						| MosaicDomainCheckpointRoot
						| undefined)
		if (state.rootKey !== null && root?.kind !== `root`) {
			throw new Error(`A Mosaic Domain checkpoint root is missing.`)
		}
		if (root !== null && root !== undefined) assertRootDependencies(root)
		let retainAfter = root?.revision ?? 0
		for (const accepted of acceptedRoots) {
			retainAfter = Math.min(retainAfter, accepted.minimumRevision)
			const protectedRoot = state.objects.get(accepted.rootKey)
			if (
				protectedRoot?.kind !== `external-root` ||
				mosaicDomainCheckpointObjectKey(protectedRoot) !== accepted.rootKey ||
				domainKey(protectedRoot.domain) !== domainKey(request.domain)
			) {
				throw new Error(`A Mosaic Domain accepted checkpoint root is invalid.`)
			}
		}
		for (const lease of activeLeases) {
			retainAfter = Math.min(retainAfter, lease.minimumRevision)
			for (const key of lease.rootKeys ?? []) {
				const protectedRoot = state.objects.get(key)
				if (protectedRoot === undefined) {
					throw new Error(
						`A Mosaic Domain checkpoint retention root is invalid.`,
					)
				}
				if (mosaicDomainCheckpointObjectKey(protectedRoot) !== key) {
					throw new Error(`A Mosaic Domain checkpoint content key is invalid.`)
				}
				if (protectedRoot.kind === `root`) {
					if (domainKey(protectedRoot.domain) !== domainKey(request.domain)) {
						throw new Error(
							`A Mosaic Domain checkpoint retention root is invalid.`,
						)
					}
					retainAfter = Math.min(retainAfter, protectedRoot.revision)
				} else if (protectedRoot.kind === `external-root`) {
					assertExternalRoot(
						protectedRoot,
						request.domain,
						state.headRevision + 1,
					)
					retainAfter = Math.min(retainAfter, protectedRoot.baseRevision)
				} else {
					throw new Error(
						`A Mosaic Domain checkpoint retention root is invalid.`,
					)
				}
			}
		}
		const live = new Set<MosaicDomainCheckpointObjectKey>()
		const pending = new Set<MosaicDomainCheckpointObjectKey>()
		if (state.rootKey !== null) pending.add(state.rootKey)
		for (const accepted of acceptedRoots) pending.add(accepted.rootKey)
		for (const lease of activeLeases) {
			for (const key of lease.rootKeys ?? []) pending.add(key)
		}
		while (pending.size > 0) {
			const key = pending.values().next().value!
			pending.delete(key)
			if (live.has(key)) continue
			const object = state.objects.get(key)
			if (object === undefined) {
				throw new Error(`A Mosaic Domain checkpoint object is missing.`)
			}
			if (mosaicDomainCheckpointObjectKey(object) !== key) {
				throw new Error(`A Mosaic Domain checkpoint content key is invalid.`)
			}
			live.add(key)
			if (object.kind === `root`) {
				assertRootDependencies(object)
				if (object.memberDirectory !== null) pending.add(object.memberDirectory)
				if (object.indexDirectory !== null) pending.add(object.indexDirectory)
				for (const externalRoot of object.externalRoots ?? []) {
					pending.add(externalRoot)
				}
			} else if (object.kind === `external-root`) {
				assertExternalRoot(object, request.domain, state.headRevision + 1)
				if (object.directory !== null) pending.add(object.directory)
				if (object.proof !== undefined) pending.add(object.proof)
			} else if (object.kind === `directory-branch`) {
				assertDirectoryObject(object)
				for (const child of object.children) pending.add(child.value)
			} else if (object.kind === `directory-leaf`) {
				assertDirectoryObject(object)
				for (const entry of object.entries) pending.add(entry.value)
			}
		}
		let deletedObjectCount = 0
		for (const key of [...state.objects.keys()]) {
			if (live.has(key)) continue
			state.objects.delete(key)
			state.externalGraphs.delete(key)
			deletedObjectCount++
		}
		for (const [id, lease] of state.retentionLeases) {
			if (leaseExpired(lease, state, this.#now())) {
				state.retentionLeases.delete(id)
			}
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
		assertRootDependencies(root)
		type Pending = {
			readonly external?: {
				readonly baseRevision: number
				readonly depth: number
				readonly rootKey: MosaicDomainCheckpointObjectKey
			}
			readonly key: MosaicDomainCheckpointObjectKey
		}
		const pending: Pending[] = [{ key: request.rootKey }]
		const externalBytes = new Map<MosaicDomainCheckpointObjectKey, number>()
		const visited = new Set<string>()
		while (pending.length > 0) {
			const item = pending.pop()!
			const { key } = item
			const visitKey = `${item.external?.rootKey ?? ``}:${key}`
			if (visited.has(visitKey)) continue
			const object = state.objects.get(key)
			if (object === undefined) {
				throw new Error(`A Mosaic Domain checkpoint object is missing.`)
			}
			if (mosaicDomainCheckpointObjectKey(object) !== key) {
				throw new Error(`A Mosaic Domain checkpoint content key is invalid.`)
			}
			visited.add(visitKey)
			if (
				item.external !== undefined &&
				object.kind !== `directory-branch` &&
				object.kind !== `directory-leaf` &&
				object.kind !== `index`
			) {
				throw new Error(`A Mosaic Domain external checkpoint graph is invalid.`)
			}
			if (object.kind === `root`) {
				assertRootDependencies(object)
				if (object.memberDirectory !== null) {
					pending.push({ key: object.memberDirectory })
				}
				if (object.indexDirectory !== null) {
					pending.push({ key: object.indexDirectory })
				}
				for (const externalRoot of object.externalRoots ?? []) {
					pending.push({ key: externalRoot })
				}
			} else if (object.kind === `external-root`) {
				assertExternalRoot(object, request.domain, request.expectedRevision)
				let summary = state.externalGraphs.get(key)
				const currentRoot =
					state.rootKey === null ? null : state.objects.get(state.rootKey)
				if (
					summary === undefined &&
					currentRoot?.kind === `root` &&
					(currentRoot.externalRoots ?? []).includes(key)
				) {
					summary = { bytes: object.bytes, depth: object.depth }
					state.externalGraphs.set(key, summary)
				}
				if (summary === undefined && object.proof !== undefined) {
					const proof = state.objects.get(object.proof)
					if (proof?.kind !== `external-proof`) {
						throw new Error(
							`A Mosaic Domain external checkpoint proof is invalid.`,
						)
					}
					summary = verifyExternalGraphProof(
						state,
						request.domain,
						new Map(),
						{
							rootKey: key,
							...(proof.previousRootKey === undefined
								? {}
								: { previousRootKey: proof.previousRootKey }),
							updates: proof.updates,
						},
						this.#now(),
					)
					state.externalGraphs.set(key, summary)
				}
				if (
					summary !== undefined &&
					(summary.bytes !== object.bytes || summary.depth !== object.depth)
				) {
					throw new Error(
						`A Mosaic Domain external checkpoint summary is invalid.`,
					)
				}
				if (summary === undefined) externalBytes.set(key, 0)
				if (summary === undefined && object.directory !== null) {
					pending.push({
						external: {
							baseRevision: object.baseRevision,
							depth: object.depth,
							rootKey: key,
						},
						key: object.directory,
					})
				}
			} else if (object.kind === `directory-branch`) {
				assertDirectoryObject(object)
				if (item.external !== undefined && object.depth > item.external.depth) {
					throw new Error(
						`A Mosaic Domain external checkpoint depth is invalid.`,
					)
				}
				for (const child of object.children) {
					pending.push({ ...item, key: child.value })
				}
			} else if (object.kind === `directory-leaf`) {
				assertDirectoryObject(object)
				if (item.external !== undefined && object.depth > item.external.depth) {
					throw new Error(
						`A Mosaic Domain external checkpoint depth is invalid.`,
					)
				}
				for (const entry of object.entries) {
					pending.push({ ...item, key: entry.value })
				}
			} else if (object.kind === `index` && item.external !== undefined) {
				if (object.revision > item.external.baseRevision) {
					throw new Error(
						`A Mosaic Domain external checkpoint index is invalid.`,
					)
				}
				externalBytes.set(
					item.external.rootKey,
					externalBytes.get(item.external.rootKey)! +
						encoder.encode(JSON.stringify(object.value)).byteLength,
				)
			}
		}
		for (const [key, bytes] of externalBytes) {
			const external = state.objects.get(
				key,
			) as MosaicDomainCheckpointExternalRoot
			if (bytes !== external.bytes) {
				throw new Error(`A Mosaic Domain external checkpoint graph is invalid.`)
			}
		}
		const publishedExternalRoots = new Set(root.externalRoots ?? [])
		for (const [revision, proposals] of state.acceptedCheckpointRoots) {
			if (revision > request.expectedRevision) continue
			for (const accepted of proposals.values()) {
				if (!publishedExternalRoots.has(accepted.rootKey)) {
					throw new Error(
						`A Mosaic Domain checkpoint omitted an accepted external root.`,
					)
				}
			}
		}
		for (const revision of state.acceptedCheckpointRoots.keys()) {
			if (revision > request.expectedRevision) continue
			state.acceptedCheckpointRoots.delete(revision)
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
			acceptedRootKeys: [
				...new Set(
					[...state.acceptedCheckpointRoots.values()].flatMap((proposals) =>
						[...proposals.values()].map(({ rootKey }) => rootKey),
					),
				),
			].sort(),
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

	/** Reopen the same backing store without process-local verification caches. */
	public restart(): InMemoryMosaicDomainCheckpointStorage {
		const restarted = new InMemoryMosaicDomainCheckpointStorage({
			maxRecentReceipts: this.#maxRecentReceipts,
			maxSessionWatermarks: this.#maxSessionWatermarks,
			now: this.#now,
		})
		restarted.#domains = this.#domains
		for (const state of this.#domains.values()) state.externalGraphs.clear()
		return restarted
	}

	public stageCheckpointObjects(
		domain: MosaicDomainIdentity,
		objects: readonly MosaicDomainCheckpointStoredObject[],
		options: MosaicDomainCheckpointStageOptions = {},
	): MosaicDomainCheckpointStageResult {
		if (!Array.isArray(objects)) {
			throw new Error(`Mosaic Domain checkpoint objects must be an array.`)
		}
		const bounded =
			options.externalGraph !== undefined ||
			options.proposal !== undefined ||
			options.limits !== undefined
		const maxStagedBytes =
			options.limits?.maxStagedBytes ??
			(bounded ? DEFAULT_EXTERNAL_STAGE_MAX_BYTES : Number.MAX_SAFE_INTEGER)
		const maxObjectBytes =
			options.limits?.maxObjectBytes ??
			(bounded
				? DEFAULT_EXTERNAL_STAGE_MAX_OBJECT_BYTES
				: Number.MAX_SAFE_INTEGER)
		const maxObjectDepth =
			options.limits?.maxObjectDepth ??
			(bounded
				? DEFAULT_EXTERNAL_STAGE_MAX_OBJECT_DEPTH
				: Number.MAX_SAFE_INTEGER)
		const maxObjectNodes =
			options.limits?.maxObjectNodes ??
			(bounded
				? DEFAULT_EXTERNAL_STAGE_MAX_OBJECT_NODES
				: Number.MAX_SAFE_INTEGER)
		const maxStagedObjects =
			options.limits?.maxStagedObjects ??
			(bounded ? DEFAULT_EXTERNAL_STAGE_MAX_OBJECTS : Number.MAX_SAFE_INTEGER)
		assertPositiveLimit(`maxStagedBytes`, maxStagedBytes)
		assertPositiveLimit(`maxObjectBytes`, maxObjectBytes)
		assertPositiveLimit(`maxObjectDepth`, maxObjectDepth)
		assertPositiveLimit(`maxObjectNodes`, maxObjectNodes)
		assertPositiveLimit(`maxStagedObjects`, maxStagedObjects)
		const deadline = options.limits?.deadline
		if (deadline !== undefined && !Number.isFinite(deadline)) {
			throw new Error(`deadline must be finite.`)
		}
		const assertStageActive = (): void => {
			if (options.signal?.aborted) {
				throw new Error(`Mosaic Domain checkpoint staging was aborted.`)
			}
			if (deadline !== undefined && Date.now() >= deadline) {
				throw new Error(`Mosaic Domain checkpoint staging deadline expired.`)
			}
		}
		assertStageActive()
		if (objects.length > maxStagedObjects) {
			throw new Error(
				`Mosaic Domain checkpoint staging exceeds ${maxStagedObjects} objects.`,
			)
		}
		const state = this.#domain(domain)
		const candidates = new Map<
			MosaicDomainCheckpointObjectKey,
			MosaicDomainCheckpointObject
		>()
		let persistedBytes = 0
		let persistedObjectCount = 0
		let stagedBytes = 0
		for (const item of objects) {
			assertStageActive()
			if (typeof item?.key !== `string` || !item.key.startsWith(`sha256:`)) {
				throw new Error(`A Mosaic Domain checkpoint object is invalid.`)
			}
			const inspectedBytes = inspectJsonSafe(
				item.value,
				maxObjectBytes,
				maxObjectDepth,
				maxObjectNodes,
				assertStageActive,
			)
			if (inspectedBytes === null) {
				throw new Error(`A Mosaic Domain checkpoint object is invalid.`)
			}
			const value = clone(item.value)
			if (stagedBytes + inspectedBytes > maxStagedBytes) {
				throw new Error(
					`Mosaic Domain checkpoint staging exceeds ${maxStagedBytes} bytes.`,
				)
			}
			stagedBytes += inspectedBytes
			assertStageActive()
			if (item.key !== mosaicDomainCheckpointObjectKey(value)) {
				throw new Error(`A Mosaic Domain checkpoint content key is invalid.`)
			}
			const existing = state.objects.get(item.key)
			if (existing !== undefined) {
				if (!same(existing, value)) {
					throw new Error(`A checkpoint content key collided.`)
				}
				candidates.set(item.key, existing)
				continue
			}
			candidates.set(item.key, value)
			persistedBytes += inspectedBytes
			persistedObjectCount++
		}
		if (
			(options.externalGraph === undefined) !==
			(options.proposal === undefined)
		) {
			throw new Error(
				`A Mosaic Domain external checkpoint stage requires one atomic proposal.`,
			)
		}
		let proposalLease: MosaicDomainCheckpointRetentionLease | null = null
		let proposalChanged = false
		let verified: { readonly bytes: number; readonly depth: number } | undefined
		if (options.externalGraph !== undefined && options.proposal !== undefined) {
			const proposal = options.proposal
			const retentionEpochs = proposal.retentionEpochs ?? 64
			const now = this.#now()
			if (
				proposal.rootKey !== options.externalGraph.rootKey ||
				!validObjectKey(proposal.rootKey) ||
				!Number.isSafeInteger(proposal.minimumRevision) ||
				proposal.minimumRevision < 0 ||
				!Number.isSafeInteger(proposal.expiresAfterRevision) ||
				proposal.expiresAfterRevision <= state.headRevision ||
				!Number.isFinite(proposal.expiresAt) ||
				proposal.expiresAt <= now ||
				!Number.isSafeInteger(retentionEpochs) ||
				retentionEpochs < 1 ||
				retentionEpochs > 1024
			) {
				throw new Error(
					`A Mosaic Domain external checkpoint proposal is invalid.`,
				)
			}
			const root =
				candidates.get(proposal.rootKey) ?? state.objects.get(proposal.rootKey)
			if (
				root?.kind !== `external-root` ||
				root.baseRevision !== proposal.expiresAfterRevision
			) {
				throw new Error(
					`A Mosaic Domain external checkpoint proposal root is invalid.`,
				)
			}
			proposalLease = {
				expiresAfterRevision: proposal.expiresAfterRevision,
				expiresAt: proposal.expiresAt,
				// The epoch increment that publishes this lease is not a completed GC
				// generation and therefore must not consume its first generation.
				expiresAtRetentionEpoch: state.retentionEpoch + retentionEpochs + 1,
				id: proposal.id,
				kind: `proposal`,
				minimumRevision: proposal.minimumRevision,
				rootKeys: [proposal.rootKey],
			}
			assertLease(proposalLease)
			const current = state.retentionLeases.get(proposal.id)
			if (current !== undefined) {
				if (
					current.kind !== `proposal` ||
					current.minimumRevision !== proposal.minimumRevision ||
					current.expiresAfterRevision !== proposal.expiresAfterRevision ||
					!same(current.rootKeys, [proposal.rootKey])
				) {
					throw new Error(
						`A Mosaic Domain external checkpoint proposal identity collided.`,
					)
				}
				if ((current.expiresAt ?? 0) > proposal.expiresAt) {
					throw new Error(
						`A Mosaic Domain external checkpoint proposal cannot shorten its expiry.`,
					)
				}
				proposalChanged = current.expiresAt !== proposal.expiresAt
				if (!proposalChanged) proposalLease = current
			} else {
				proposalChanged = true
			}
			verified = verifyExternalGraphProof(
				state,
				domain,
				candidates,
				options.externalGraph,
				now,
				assertStageActive,
			)
		}
		assertStageActive()
		for (const [key, value] of candidates) {
			if (!state.objects.has(key)) state.objects.set(key, value)
		}
		if (verified !== undefined && options.externalGraph !== undefined) {
			state.externalGraphs.set(options.externalGraph.rootKey, verified)
		}
		if (proposalChanged && proposalLease !== null) {
			state.retentionLeases.set(proposalLease.id, clone(proposalLease))
			state.retentionEpoch++
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
			if (root === undefined || mosaicDomainCheckpointObjectKey(root) !== key) {
				throw new Error(`A Mosaic Domain checkpoint retention root is invalid.`)
			}
			if (root.kind === `root`) {
				if (domainKey(root.domain) !== domainKey(domain)) {
					throw new Error(
						`A Mosaic Domain checkpoint retention root is invalid.`,
					)
				}
			} else if (root.kind === `external-root`) {
				throw new Error(
					`An external checkpoint root must be protected by atomic staging.`,
				)
			} else {
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

	public stats(domain: MosaicDomainIdentity): {
		readonly acceptedRootProtectionCount: number
		readonly externalValidationHashedBytes: number
		readonly externalValidationObjectReads: number
		readonly externalValidationSerializedBytes: number
		readonly objectCount: number
		readonly operationReceiptCount: number
		readonly receiptCount: number
		readonly retentionLeaseCount: number
		readonly sessionWatermarkCount: number
		readonly tailBatchCount: number
	} {
		const state = this.#domain(domain)
		return {
			acceptedRootProtectionCount: [
				...state.acceptedCheckpointRoots.values(),
			].reduce((count, proposals) => count + proposals.size, 0),
			externalValidationHashedBytes: state.externalValidationHashedBytes,
			externalValidationObjectReads: state.externalValidationObjectReads,
			externalValidationSerializedBytes: state.externalValidationSerializedBytes,
			objectCount: state.objects.size,
			operationReceiptCount: state.operations.size,
			receiptCount: state.receipts.size,
			retentionLeaseCount: state.retentionLeases.size,
			sessionWatermarkCount: state.sessionWatermarks.size,
			tailBatchCount: state.tail.size,
		}
	}

	#domain(identity: MosaicDomainIdentity): MemoryDomain {
		const key = domainKey(identity)
		let state = this.#domains.get(key)
		if (state === undefined) {
			state = {
				acceptedCheckpointRoots: new Map(),
				externalGraphs: new Map(),
				externalValidationHashedBytes: 0,
				externalValidationObjectReads: 0,
				externalValidationSerializedBytes: 0,
				headRevision: 0,
				objects: new Map(),
				operations: new Map(),
				receipts: new Map(),
				recentReceiptIds: [],
				retentionEpoch: 0,
				retentionLeases: new Map(),
				rootKey: null,
				sessionWatermarks: new Map(),
				tail: new Map(),
			}
			this.#domains.set(key, state)
		}
		return state
	}
}
