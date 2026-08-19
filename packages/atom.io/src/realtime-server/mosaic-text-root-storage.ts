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
	readonly limits?: {
		readonly maxBytes?: number
		readonly maxObjectBytes?: number
		readonly maxUpdates?: number
	}
	readonly previousRootKey?: MosaicDomainCheckpointObjectKey
	/** Bounded reader for nodes in the previously published external root. */
	readonly previous?: MosaicTextRootCheckpointReader
	readonly proposal?: Omit<MosaicDomainCheckpointStageProposal, `rootKey`>
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

const nodePath = (value: MosaicTextRootObject): string =>
	createHash(`sha256`).update(canonicalize(value)).digest(`hex`)

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

/**
 * Adapt Mosaic Text v3's Merkle writer to an unreachable MOS-13 external graph.
 * `stage()` persists the bounded graph but does not publish it as authoritative.
 */
export function createMosaicTextRootCheckpointStage(
	options: MosaicTextRootCheckpointStageOptions,
): MosaicTextRootCheckpointStage {
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
		referenceDeltas.set(key, (referenceDeltas.get(key) ?? 0) + delta)
	}

	return {
		put(value) {
			const path = nodePath(value)
			const nodeKey = `sha256:${path}` as const
			const object = indexObject(options, path, value)
			const prior = pendingByPath.get(path)
			if (
				prior !== undefined &&
				canonicalize(prior.value) !== canonicalize(value)
			) {
				throw new Error(`A Mosaic Text v3 checkpoint path collided.`)
			}
			pendingByPath.set(path, object)
			pendingByKey.set(nodeKey, object)
			adjustReferences(nodeKey, 1)
			return nodeKey
		},
		retire(key) {
			adjustReferences(key, -1)
		},
		async read(key) {
			const pending = pendingByKey.get(key)
			if (pending !== undefined) {
				return structuredClone(pending.value) as unknown as MosaicTextRootObject
			}
			return (await options.previous?.read(key)) ?? null
		},
		async stage(root) {
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
				storage: options.storage,
				updates,
			})
			for (const expected of pendingByKey.values()) {
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
