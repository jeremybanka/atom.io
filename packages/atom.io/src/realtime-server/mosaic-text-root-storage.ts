import { createHash } from "node:crypto"

import type {
	MosaicDomainCheckpointIndex,
	MosaicDomainCheckpointObjectKey,
	MosaicDomainIdentity,
	MosaicTextRoot,
	MosaicTextRootObject,
	MosaicTextRootReadAdapter,
	MosaicTextRootWriteAdapter,
} from "atom.io/realtime"

import {
	type MosaicDomainExternalCheckpointGraphLimits,
	type MosaicDomainExternalCheckpointGraphResult,
	stageMosaicDomainExternalCheckpointGraph,
} from "./mosaic-domain-checkpoint.ts"
import {
	mosaicDomainCheckpointObjectKey,
	type MosaicDomainCheckpointStageProposal,
	type MosaicDomainCheckpointStorageAdapter,
} from "./mosaic-domain-checkpoint-storage.ts"

export const MOSAIC_TEXT_ROOT_CHECKPOINT_INDEX =
	`atom.io:mosaic-text-root:v3` as const
export const MOSAIC_TEXT_ROOT_REFERENCE_COUNT_INDEX =
	`atom.io:mosaic-text-root:references:v3` as const
export const MOSAIC_TEXT_ROOT_MANIFEST_INDEX =
	`atom.io:mosaic-text-root:manifest:v3` as const

export type MosaicTextRootCheckpointReader = MosaicTextRootReadAdapter & {
	root(): Promise<MosaicTextRoot>
	referenceCount(key: MosaicDomainCheckpointObjectKey): Promise<number>
}

export type MosaicTextRootCheckpointStageOptions = {
	readonly baseRevision: number
	readonly domain: MosaicDomainIdentity
	readonly limits?: MosaicDomainExternalCheckpointGraphLimits
	readonly previousRootKey?: MosaicDomainCheckpointObjectKey
	/** Bounded reader for nodes in the previously published external root. */
	readonly previous?: MosaicTextRootCheckpointReader
	readonly proposal?: Omit<MosaicDomainCheckpointStageProposal, `rootKey`>
	readonly signal?: AbortSignal
	readonly storage: MosaicDomainCheckpointStorageAdapter
}

export type MosaicTextRootCheckpointStage = MosaicTextRootWriteAdapter & {
	stage(root: MosaicTextRoot): Promise<MosaicDomainExternalCheckpointGraphResult>
}

export type MosaicTextRootExternalIndexReader = {
	readExternalIndexes(
		rootKey: MosaicDomainCheckpointObjectKey,
		addresses: readonly { readonly index: string; readonly path: string }[],
	): Promise<readonly MosaicDomainCheckpointIndex[]>
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

const visitCanonicalJson = (
	value: unknown,
	visit: (chunk: string) => void,
	reserveNodes: (count: number) => void,
	depth = 0,
	maxDepth = Number.MAX_SAFE_INTEGER,
	reserved = false,
): void => {
	if (!reserved) reserveNodes(1)
	if (depth > maxDepth) {
		throw new Error(
			`A Mosaic Text v3 checkpoint object exceeds depth ${maxDepth}.`,
		)
	}
	if (value === null || typeof value !== `object`) {
		visit(JSON.stringify(value))
		return
	}
	if (Array.isArray(value)) {
		visit(`[`)
		reserveNodes(value.length)
		for (const [index, item] of value.entries()) {
			if (index > 0) visit(`,`)
			visitCanonicalJson(item, visit, reserveNodes, depth + 1, maxDepth, true)
		}
		visit(`]`)
		return
	}
	visit(`{`)
	const object = value as Readonly<Record<string, unknown>>
	const keys: string[] = []
	for (const key in object) {
		if (!Object.hasOwn(object, key)) continue
		reserveNodes(1)
		keys.push(key)
	}
	for (const [index, key] of keys.sort().entries()) {
		if (index > 0) visit(`,`)
		visit(JSON.stringify(key))
		visit(`:`)
		visitCanonicalJson(
			object[key],
			visit,
			reserveNodes,
			depth + 1,
			maxDepth,
			true,
		)
	}
	visit(`}`)
}

const inspectNode = (
	value: MosaicTextRootObject,
	limits: {
		readonly maxBytes: number
		readonly maxDepth: number
		readonly maxNodes: number
		readonly remainingBytes: number
	},
	assertActive: () => void,
): { readonly bytes: number; readonly path: string } => {
	if (
		value.kind === `mosaic-text-root-leaf` &&
		value.text.length > Math.min(limits.maxBytes, limits.remainingBytes)
	) {
		throw new Error(
			`A Mosaic Text v3 checkpoint staging byte limit was exceeded.`,
		)
	}
	const hash = createHash(`sha256`)
	const encoder = new TextEncoder()
	let bytes = 0
	let nodes = 0
	visitCanonicalJson(
		value,
		(chunk) => {
			assertActive()
			const chunkBytes = encoder.encode(chunk).byteLength
			if (
				bytes + chunkBytes > limits.maxBytes ||
				bytes + chunkBytes > limits.remainingBytes
			) {
				throw new Error(
					`A Mosaic Text v3 checkpoint staging byte limit was exceeded.`,
				)
			}
			bytes += chunkBytes
			hash.update(chunk)
		},
		(count) => {
			assertActive()
			if (count > limits.maxNodes - nodes) {
				throw new Error(
					`A Mosaic Text v3 checkpoint object exceeds ${limits.maxNodes} nodes.`,
				)
			}
			nodes += count
		},
		0,
		limits.maxDepth,
	)
	return { bytes, path: hash.digest(`hex`) }
}

const indexObject = (
	options: Pick<MosaicTextRootCheckpointStageOptions, `baseRevision`>,
	path: string,
	value: MosaicTextRootObject,
): MosaicDomainCheckpointIndex => ({
	index: MOSAIC_TEXT_ROOT_CHECKPOINT_INDEX,
	kind: `index`,
	path,
	revision: options.baseRevision,
	value,
})

const DEFAULT_TEXT_STAGE_MAX_OBJECT_BYTES = 4 * 1024 * 1024
const DEFAULT_TEXT_STAGE_MAX_OBJECT_DEPTH = 64
const DEFAULT_TEXT_STAGE_MAX_OBJECT_NODES = 262_144
const DEFAULT_TEXT_STAGE_MAX_STAGED_BYTES = 16 * 1024 * 1024
const DEFAULT_TEXT_STAGE_MAX_STAGED_OBJECTS = 4_096
const DEFAULT_TEXT_STAGE_MAX_UPDATES = 256

const positiveLimit = (name: string, value: number): number => {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive safe integer.`)
	}
	return value
}

/**
 * Adapt Mosaic Text v3's Merkle writer to an unreachable MOS-13 external graph.
 * `stage()` persists the bounded graph but does not publish it as authoritative.
 */
export function createMosaicTextRootCheckpointStage(
	options: MosaicTextRootCheckpointStageOptions,
): MosaicTextRootCheckpointStage {
	const maxObjectBytes = positiveLimit(
		`maxObjectBytes`,
		options.limits?.maxObjectBytes ?? DEFAULT_TEXT_STAGE_MAX_OBJECT_BYTES,
	)
	const maxObjectDepth = positiveLimit(
		`maxObjectDepth`,
		options.limits?.maxObjectDepth ?? DEFAULT_TEXT_STAGE_MAX_OBJECT_DEPTH,
	)
	const maxObjectNodes = positiveLimit(
		`maxObjectNodes`,
		options.limits?.maxObjectNodes ?? DEFAULT_TEXT_STAGE_MAX_OBJECT_NODES,
	)
	const maxStagedBytes = positiveLimit(
		`maxStagedBytes`,
		options.limits?.maxStagedBytes ?? DEFAULT_TEXT_STAGE_MAX_STAGED_BYTES,
	)
	const maxStagedObjects = positiveLimit(
		`maxStagedObjects`,
		options.limits?.maxStagedObjects ?? DEFAULT_TEXT_STAGE_MAX_STAGED_OBJECTS,
	)
	const maxUpdates = positiveLimit(
		`maxUpdates`,
		options.limits?.maxUpdates ?? DEFAULT_TEXT_STAGE_MAX_UPDATES,
	)
	const deadline = options.limits?.deadline
	if (deadline !== undefined && !Number.isFinite(deadline)) {
		throw new Error(`deadline must be finite.`)
	}
	const assertStageActive = (): void => {
		if (options.signal?.aborted) {
			throw new Error(`Mosaic Text v3 checkpoint staging was aborted.`)
		}
		if (deadline !== undefined && Date.now() >= deadline) {
			throw new Error(`Mosaic Text v3 checkpoint staging deadline expired.`)
		}
	}
	assertStageActive()
	let stagedBytes = 0
	let stagedObjectCount = 0
	let completed:
		| {
				readonly result: MosaicDomainExternalCheckpointGraphResult
				readonly root: MosaicTextRoot
		  }
		| undefined
	const pendingByKey = new Map<
		MosaicDomainCheckpointObjectKey,
		MosaicDomainCheckpointIndex
	>()
	const pendingByPath = new Map<string, MosaicDomainCheckpointIndex>()
	const referenceDeltas = new Map<MosaicDomainCheckpointObjectKey, number>()
	const adjustReferences = (
		key: MosaicDomainCheckpointObjectKey,
		delta: number,
	): void => {
		assertStageActive()
		if (
			!referenceDeltas.has(key) &&
			1 + (referenceDeltas.size + 1) * 2 > maxUpdates
		) {
			throw new Error(
				`Mosaic Text v3 checkpoint staging exceeds ${maxUpdates} updates.`,
			)
		}
		referenceDeltas.set(key, (referenceDeltas.get(key) ?? 0) + delta)
	}

	return {
		put(value) {
			assertStageActive()
			if (stagedObjectCount >= maxStagedObjects) {
				throw new Error(
					`Mosaic Text v3 checkpoint staging exceeds ${maxStagedObjects} objects.`,
				)
			}
			const inspected = inspectNode(
				value,
				{
					maxBytes: maxObjectBytes,
					maxDepth: maxObjectDepth,
					maxNodes: maxObjectNodes,
					remainingBytes: maxStagedBytes - stagedBytes,
				},
				assertStageActive,
			)
			const path = inspected.path
			const nodeKey = `sha256:${path}` as const
			const object = indexObject(options, path, value)
			const prior = pendingByPath.get(path)
			if (
				prior !== undefined &&
				canonicalize(prior.value) !== canonicalize(value)
			) {
				throw new Error(`A Mosaic Text v3 checkpoint path collided.`)
			}
			const newReference = !referenceDeltas.has(nodeKey)
			if (1 + (referenceDeltas.size + (newReference ? 1 : 0)) * 2 > maxUpdates) {
				throw new Error(
					`Mosaic Text v3 checkpoint staging exceeds ${maxUpdates} updates.`,
				)
			}
			stagedBytes += inspected.bytes
			stagedObjectCount++
			pendingByPath.set(path, object)
			pendingByKey.set(nodeKey, object)
			adjustReferences(nodeKey, 1)
			return nodeKey
		},
		retire(key) {
			assertStageActive()
			adjustReferences(key, -1)
		},
		async read(key) {
			assertStageActive()
			const pending = pendingByKey.get(key)
			if (pending !== undefined) {
				return structuredClone(pending.value) as unknown as MosaicTextRootObject
			}
			const value = (await options.previous?.read(key)) ?? null
			assertStageActive()
			return value
		},
		async stage(root) {
			assertStageActive()
			if (completed !== undefined) {
				if (canonicalize(completed.root) !== canonicalize(root)) {
					throw new Error(`A Mosaic Text v3 stage was reused for another root.`)
				}
				return completed.result
			}
			const updates: Parameters<
				typeof stageMosaicDomainExternalCheckpointGraph
			>[0][`updates`][number][] = []
			updates.push({
				index: MOSAIC_TEXT_ROOT_MANIFEST_INDEX,
				path: `root`,
				value: root,
			})
			for (const [key, delta] of referenceDeltas) {
				assertStageActive()
				if (delta === 0) continue
				const path = key.slice(`sha256:`.length)
				const previous = await options.previous?.referenceCount(key)
				const next = (previous ?? 0) + delta
				if (!Number.isSafeInteger(next) || next < 0) {
					throw new Error(`A Mosaic Text v3 reference count is invalid.`)
				}
				if (next === 0) {
					updates.push({
						index: MOSAIC_TEXT_ROOT_CHECKPOINT_INDEX,
						path,
						remove: true,
					})
					updates.push({
						index: MOSAIC_TEXT_ROOT_REFERENCE_COUNT_INDEX,
						path,
						remove: true,
					})
					continue
				}
				const node = pendingByKey.get(key)
				if (node !== undefined) {
					updates.push({
						index: node.index,
						path: node.path,
						value: node.value,
					})
				}
				updates.push({
					index: MOSAIC_TEXT_ROOT_REFERENCE_COUNT_INDEX,
					path,
					value: next,
				})
			}
			const result = await stageMosaicDomainExternalCheckpointGraph({
				baseRevision: options.baseRevision,
				domain: options.domain,
				limits: options.limits,
				...(options.previousRootKey === undefined
					? {}
					: { previousRootKey: options.previousRootKey }),
				...(options.proposal === undefined
					? {}
					: { proposal: options.proposal }),
				...(options.signal === undefined ? {} : { signal: options.signal }),
				storage: options.storage,
				updates,
			})
			for (const [nodeKey, expected] of pendingByKey) {
				if ((referenceDeltas.get(nodeKey) ?? 0) <= 0) continue
				const key = mosaicDomainCheckpointObjectKey(expected)
				const stored = await options.storage.readCheckpointObject(
					options.domain,
					key,
				)
				if (
					stored === null ||
					mosaicDomainCheckpointObjectKey(stored) !== key ||
					canonicalize(stored) !== canonicalize(expected)
				) {
					throw new Error(`A Mosaic Text v3 staged object failed verification.`)
				}
			}
			completed = { result, root: structuredClone(root) }
			pendingByKey.clear()
			pendingByPath.clear()
			referenceDeltas.clear()
			return result
		},
	}
}

/** Read individually addressed text nodes through one published external root. */
export function createMosaicTextRootCheckpointReader(options: {
	readonly checkpoint: MosaicTextRootExternalIndexReader
	readonly rootKey: MosaicDomainCheckpointObjectKey
}): MosaicTextRootCheckpointReader {
	const readIndexes = async (
		key: MosaicDomainCheckpointObjectKey,
		indexes: readonly string[],
	): Promise<readonly MosaicDomainCheckpointIndex[]> =>
		options.checkpoint.readExternalIndexes(
			options.rootKey,
			indexes.map((index) => ({
				index,
				path: key.slice(`sha256:`.length),
			})),
		)
	return {
		async read(key) {
			if (!/^sha256:[0-9a-f]{64}$/u.test(key)) return null
			const [object] = await readIndexes(key, [
				MOSAIC_TEXT_ROOT_CHECKPOINT_INDEX,
			])
			return object === undefined
				? null
				: (structuredClone(object.value) as unknown as MosaicTextRootObject)
		},
		async referenceCount(key) {
			if (!/^sha256:[0-9a-f]{64}$/u.test(key)) return 0
			const [object] = await readIndexes(key, [
				MOSAIC_TEXT_ROOT_REFERENCE_COUNT_INDEX,
			])
			if (object === undefined) return 0
			if (!Number.isSafeInteger(object.value) || (object.value as number) < 1) {
				throw new Error(`A Mosaic Text v3 reference count is invalid.`)
			}
			return object.value as number
		},
		async root() {
			const [object] = await options.checkpoint.readExternalIndexes(
				options.rootKey,
				[{ index: MOSAIC_TEXT_ROOT_MANIFEST_INDEX, path: `root` }],
			)
			const root = object?.value as MosaicTextRoot | undefined
			if (
				root?.version !== 3 ||
				!Number.isSafeInteger(root.generation) ||
				root.generation < 1
			) {
				throw new Error(`A Mosaic Text v3 root manifest is invalid.`)
			}
			return structuredClone(root)
		},
	}
}
