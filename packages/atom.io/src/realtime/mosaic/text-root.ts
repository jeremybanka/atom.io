import type { MosaicDomainCheckpointObjectKey } from "../mosaic-domain-checkpoint.ts"

/** Mosaic Text's storage-root protocol is intentionally distinct from v2. */
export const MOSAIC_TEXT_ROOT_PROTOCOL_VERSION = 3 as const

export type MosaicTextRootSummary = {
	readonly graphemes: number
	readonly lineBreaks: number
	readonly utf16Units: number
}

export type MosaicTextRootReference = {
	readonly depth: number
	readonly key: MosaicDomainCheckpointObjectKey
	readonly summary: MosaicTextRootSummary
}

export type MosaicTextRootLeaf = {
	readonly depth: 0
	readonly kind: `mosaic-text-root-leaf`
	readonly summary: MosaicTextRootSummary
	readonly text: string
	readonly version: typeof MOSAIC_TEXT_ROOT_PROTOCOL_VERSION
}

export type MosaicTextRootBranch = {
	readonly children: readonly MosaicTextRootReference[]
	readonly depth: number
	readonly kind: `mosaic-text-root-branch`
	readonly summary: MosaicTextRootSummary
	readonly version: typeof MOSAIC_TEXT_ROOT_PROTOCOL_VERSION
}

export type MosaicTextRootObject = MosaicTextRootBranch | MosaicTextRootLeaf

export type MosaicTextRoot = {
	readonly generation: number
	readonly reference: MosaicTextRootReference | null
	readonly version: typeof MOSAIC_TEXT_ROOT_PROTOCOL_VERSION
}

export type MosaicTextRootReadAdapter = {
	read(
		key: MosaicDomainCheckpointObjectKey,
	): MosaicTextRootObject | null | Promise<MosaicTextRootObject | null>
}

/**
 * A writer must stage immutable objects by their canonical content key. Staged
 * objects stay unreachable until a consumer atomically publishes the returned
 * MosaicTextRoot through its authoritative Domain operation.
 */
export type MosaicTextRootWriteAdapter = MosaicTextRootReadAdapter & {
	put(
		object: MosaicTextRootObject,
	): MosaicDomainCheckpointObjectKey | Promise<MosaicDomainCheckpointObjectKey>
	/** Mark a replaced object unreachable from the next staged root. */
	retire?(key: MosaicDomainCheckpointObjectKey): void | Promise<void>
}

export type MosaicTextRootCounters = {
	readonly branchesVisited: number
	readonly branchesWritten: number
	readonly leavesVisited: number
	readonly leavesWritten: number
	readonly objectReads: number
	readonly stagedBytes: number
	readonly utf16Scanned: number
}

export type MosaicTextRootMutation = {
	readonly counters: MosaicTextRootCounters
	readonly root: MosaicTextRoot
}

export type MosaicTextRootReader = {
	resolveUtf16Boundary(
		root: MosaicTextRoot,
		offset: number,
		affinity: `left` | `right`,
		limit?: number,
	): Promise<{
		readonly counters: MosaicTextRootCounters
		readonly offset: number
	}>
	readRange(
		root: MosaicTextRoot,
		range: { readonly end: number; readonly start: number },
		limit?: number,
	): Promise<{
		readonly counters: MosaicTextRootCounters
		readonly text: string
	}>
}

const MAXIMUM_CHILDREN = 32
const MAXIMUM_LEAF_GRAPHEMES = 32_768
const MAXIMUM_LEAF_UTF16 = 65_536
export const MOSAIC_TEXT_ROOT_MAXIMUM_IMPORT_CHUNK_UTF16 = 262_144
const encoder = new TextEncoder()
const segmenter = new Intl.Segmenter(undefined, { granularity: `grapheme` })

const canonicalize = (value: unknown): string => {
	if (value === null || typeof value !== `object`) return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(`,`)}]`
	const object = value as Readonly<Record<string, unknown>>
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
		.join(`,`)}}`
}

/** Deterministic raw-node key used by storage and untrusted range readers. */
export async function mosaicTextRootObjectKey(
	value: MosaicTextRootObject,
): Promise<MosaicDomainCheckpointObjectKey> {
	const digest = await globalThis.crypto.subtle.digest(
		`SHA-256`,
		encoder.encode(canonicalize(value)),
	)
	return `sha256:${[...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, `0`))
		.join(``)}`
}

const emptyCounters = (): MutableCounters => ({
	branchesVisited: 0,
	branchesWritten: 0,
	leavesVisited: 0,
	leavesWritten: 0,
	objectReads: 0,
	stagedBytes: 0,
	utf16Scanned: 0,
})

type MutableCounters = {
	branchesVisited: number
	branchesWritten: number
	leavesVisited: number
	leavesWritten: number
	objectReads: number
	stagedBytes: number
	utf16Scanned: number
}

const sameSummary = (
	left: MosaicTextRootSummary,
	right: MosaicTextRootSummary,
): boolean =>
	left.graphemes === right.graphemes &&
	left.lineBreaks === right.lineBreaks &&
	left.utf16Units === right.utf16Units

const addSummary = (
	left: MosaicTextRootSummary,
	right: MosaicTextRootSummary,
): MosaicTextRootSummary => ({
	graphemes: left.graphemes + right.graphemes,
	lineBreaks: left.lineBreaks + right.lineBreaks,
	utf16Units: left.utf16Units + right.utf16Units,
})

const summarizeChildren = (
	children: readonly MosaicTextRootReference[],
): MosaicTextRootSummary =>
	children.reduce((summary, child) => addSummary(summary, child.summary), {
		graphemes: 0,
		lineBreaks: 0,
		utf16Units: 0,
	})

const visitGraphemes = (
	text: string,
	visit: (start: number, end: number) => void,
): void => {
	let cursor = 0
	while (cursor < text.length) {
		if (text.charCodeAt(cursor) <= 0x7f) {
			let end = cursor + 1
			while (end < text.length && text.charCodeAt(end) <= 0x7f) end++
			const retained =
				end < text.length &&
				end - cursor >= 2 &&
				text.charCodeAt(end - 2) === 0x0d &&
				text.charCodeAt(end - 1) === 0x0a
					? 2
					: 1
			const fastEnd =
				end === text.length ? end : Math.max(cursor, end - retained)
			while (cursor < fastEnd) {
				const next =
					text.charCodeAt(cursor) === 0x0d &&
					cursor + 1 < fastEnd &&
					text.charCodeAt(cursor + 1) === 0x0a
						? cursor + 2
						: cursor + 1
				visit(cursor, next)
				cursor = next
			}
			if (cursor === text.length) break
		}
		const complexStart = cursor
		let complexEnd = text.length
		for (let index = cursor + 1; index < text.length; index++) {
			if (
				text.charCodeAt(index - 1) <= 0x7f &&
				text.charCodeAt(index) <= 0x7f &&
				!(text.charCodeAt(index - 1) === 0x0d && text.charCodeAt(index) === 0x0a)
			) {
				complexEnd = index
				break
			}
		}
		const complex = text.slice(complexStart, complexEnd)
		for (const { index, segment } of segmenter.segment(complex)) {
			visit(complexStart + index, complexStart + index + segment.length)
		}
		cursor = complexEnd
	}
}

const summarizeText = (text: string): MosaicTextRootSummary => {
	let graphemes = 0
	let lineBreaks = 0
	visitGraphemes(text, (start, end) => {
		graphemes++
		if (
			(end - start === 1 && text.charCodeAt(start) === 0x0a) ||
			(end - start === 2 &&
				text.charCodeAt(start) === 0x0d &&
				text.charCodeAt(start + 1) === 0x0a)
		) {
			lineBreaks++
		}
	})
	return { graphemes, lineBreaks, utf16Units: text.length }
}

const splitLeaves = (text: string): readonly MosaicTextRootLeaf[] => {
	if (text.length === 0) return []
	const leaves: MosaicTextRootLeaf[] = []
	let start = 0
	let end = 0
	let graphemes = 0
	let lineBreaks = 0
	const flush = (): void => {
		if (graphemes === 0) return
		leaves.push({
			depth: 0,
			kind: `mosaic-text-root-leaf`,
			summary: { graphemes, lineBreaks, utf16Units: end - start },
			text: text.slice(start, end),
			version: MOSAIC_TEXT_ROOT_PROTOCOL_VERSION,
		})
		start = end
		graphemes = 0
		lineBreaks = 0
	}
	visitGraphemes(text, (graphemeStart, graphemeEnd) => {
		if (
			graphemes > 0 &&
			(graphemes === MAXIMUM_LEAF_GRAPHEMES ||
				graphemeEnd - start > MAXIMUM_LEAF_UTF16)
		) {
			end = graphemeStart
			flush()
		}
		end = graphemeEnd
		graphemes++
		if (
			(graphemeEnd - graphemeStart === 1 &&
				text.charCodeAt(graphemeStart) === 0x0a) ||
			(graphemeEnd - graphemeStart === 2 &&
				text.charCodeAt(graphemeStart) === 0x0d &&
				text.charCodeAt(graphemeStart + 1) === 0x0a)
		) {
			lineBreaks++
		}
	})
	flush()
	return leaves
}

const validateNode = (
	key: MosaicDomainCheckpointObjectKey,
	value: MosaicTextRootObject | null,
	reference?: MosaicTextRootReference,
	counters?: MutableCounters,
): MosaicTextRootObject => {
	if (value?.kind === `mosaic-text-root-leaf`) {
		if (counters !== undefined) counters.utf16Scanned += value.text.length
	}
	if (
		value === null ||
		value.version !== MOSAIC_TEXT_ROOT_PROTOCOL_VERSION ||
		(value.kind === `mosaic-text-root-leaf`
			? value.depth !== 0 ||
				value.text.length === 0 ||
				value.text.length > MAXIMUM_LEAF_UTF16 ||
				!sameSummary(value.summary, summarizeText(value.text))
			: !Number.isSafeInteger(value.depth) ||
				value.depth < 1 ||
				value.children.length < 1 ||
				value.children.length > MAXIMUM_CHILDREN ||
				value.children.some((child) => child.depth !== value.depth - 1) ||
				!sameSummary(value.summary, summarizeChildren(value.children))) ||
		(reference !== undefined &&
			(reference.key !== key ||
				reference.depth !== value.depth ||
				!sameSummary(reference.summary, value.summary)))
	) {
		throw new Error(`Invalid Mosaic Text v3 root object "${key}".`)
	}
	return value
}

const readNode = async (
	reader: MosaicTextRootReadAdapter,
	reference: MosaicTextRootReference,
	counters: MutableCounters,
): Promise<MosaicTextRootObject> => {
	counters.objectReads++
	const node = validateNode(
		reference.key,
		await reader.read(reference.key),
		reference,
	)
	if ((await mosaicTextRootObjectKey(node)) !== reference.key) {
		throw new Error(`A Mosaic Text v3 root object content key is invalid.`)
	}
	if (node.kind === `mosaic-text-root-leaf`)
		counters.utf16Scanned += node.text.length
	if (node.kind === `mosaic-text-root-leaf`) counters.leavesVisited++
	else counters.branchesVisited++
	return node
}

const stageNode = async (
	writer: MosaicTextRootWriteAdapter,
	node: MosaicTextRootObject,
	counters: MutableCounters,
): Promise<MosaicTextRootReference> => {
	validateNode(`sha256:${`0`.repeat(64)}`, node, undefined, counters)
	const expectedKey = await mosaicTextRootObjectKey(node)
	const key = await writer.put(node)
	if (key !== expectedKey) {
		throw new Error(`A Mosaic Text v3 writer returned an invalid content key.`)
	}
	counters.stagedBytes += encoder.encode(JSON.stringify(node)).byteLength
	if (node.kind === `mosaic-text-root-leaf`) counters.leavesWritten++
	else counters.branchesWritten++
	return { depth: node.depth, key, summary: node.summary }
}

const stageLeaves = async (
	writer: MosaicTextRootWriteAdapter,
	text: string,
	counters: MutableCounters,
): Promise<readonly MosaicTextRootReference[]> => {
	counters.utf16Scanned += text.length
	const references: MosaicTextRootReference[] = []
	for (const leaf of splitLeaves(text)) {
		references.push(await stageNode(writer, leaf, counters))
	}
	return references
}

/**
 * Stage a decoded text stream without retaining a full input string. The
 * unresolved final grapheme is carried across chunks so CRLF, combining marks,
 * and emoji sequences cannot be split by transport chunk boundaries.
 */
export async function stageMosaicTextRootImportStream(
	writer: MosaicTextRootWriteAdapter,
	chunks: AsyncIterable<string>,
	generation = 1,
): Promise<MosaicTextRootMutation> {
	if (!Number.isSafeInteger(generation) || generation < 1) {
		throw new RangeError(`A Mosaic Text v3 generation must be positive.`)
	}
	const counters = emptyCounters()
	const references: MosaicTextRootReference[] = []
	let carry = ``
	let leafBuffer = ``
	const stageBufferedLeaves = async (final: boolean): Promise<void> => {
		const leaves = splitLeaves(leafBuffer)
		const staged = final ? leaves : leaves.slice(0, -1)
		for (const leaf of staged) {
			references.push(await stageNode(writer, leaf, counters))
		}
		leafBuffer = final ? `` : (leaves.at(-1)?.text ?? ``)
	}

	for await (const chunk of chunks) {
		if (typeof chunk !== `string`) {
			throw new TypeError(`A Mosaic Text v3 import chunk must be a string.`)
		}
		if (chunk.length === 0) continue
		if (chunk.length > MOSAIC_TEXT_ROOT_MAXIMUM_IMPORT_CHUNK_UTF16) {
			throw new Error(
				`A Mosaic Text v3 import chunk exceeds ${MOSAIC_TEXT_ROOT_MAXIMUM_IMPORT_CHUNK_UTF16} UTF-16 units.`,
			)
		}
		const combined = `${carry}${chunk}`
		// Carry is scanned again because the next code point can extend the final
		// grapheme. Count that real work instead of reporting only source bytes.
		counters.utf16Scanned += combined.length
		let finalStart = 0
		let finalEnd = 0
		visitGraphemes(combined, (start, end) => {
			finalStart = start
			finalEnd = end
		})
		if (finalEnd - finalStart > MAXIMUM_LEAF_UTF16) {
			throw new Error(
				`A Mosaic Text v3 grapheme exceeds ${MAXIMUM_LEAF_UTF16} UTF-16 units.`,
			)
		}
		leafBuffer += combined.slice(0, finalStart)
		carry = combined.slice(finalStart, finalEnd)
		if (leafBuffer.length >= MAXIMUM_LEAF_UTF16 * 2) {
			await stageBufferedLeaves(false)
		}
	}
	leafBuffer += carry
	await stageBufferedLeaves(true)
	return {
		counters,
		root: {
			generation,
			reference: await rootFromReferences(writer, references, counters),
			version: MOSAIC_TEXT_ROOT_PROTOCOL_VERSION,
		},
	}
}

const stageBranchLevel = async (
	writer: MosaicTextRootWriteAdapter,
	children: readonly MosaicTextRootReference[],
	depth: number,
	counters: MutableCounters,
): Promise<readonly MosaicTextRootReference[]> => {
	const references: MosaicTextRootReference[] = []
	for (let start = 0; start < children.length; start += MAXIMUM_CHILDREN) {
		const group = children.slice(start, start + MAXIMUM_CHILDREN)
		references.push(
			await stageNode(
				writer,
				{
					children: group,
					depth,
					kind: `mosaic-text-root-branch`,
					summary: summarizeChildren(group),
					version: MOSAIC_TEXT_ROOT_PROTOCOL_VERSION,
				},
				counters,
			),
		)
	}
	return references
}

const rootFromReferences = async (
	writer: MosaicTextRootWriteAdapter,
	references: readonly MosaicTextRootReference[],
	counters: MutableCounters,
): Promise<MosaicTextRootReference | null> => {
	let level = references
	let depth = references[0]?.depth ?? 0
	while (level.length > 1) {
		depth++
		level = await stageBranchLevel(writer, level, depth, counters)
	}
	return level[0] ?? null
}

/** Stage a deterministic, unreachable v3 graph for one atomic bulk import. */
export async function stageMosaicTextRootImport(
	writer: MosaicTextRootWriteAdapter,
	text: string,
	generation = 1,
): Promise<MosaicTextRootMutation> {
	if (!Number.isSafeInteger(generation) || generation < 1) {
		throw new RangeError(`A Mosaic Text v3 generation must be positive.`)
	}
	const counters = emptyCounters()
	const leaves = await stageLeaves(writer, text, counters)
	return {
		counters,
		root: {
			generation,
			reference: await rootFromReferences(writer, leaves, counters),
			version: MOSAIC_TEXT_ROOT_PROTOCOL_VERSION,
		},
	}
}

type RewriteState = { inserted: boolean }

const rewriteReference = async (
	writer: MosaicTextRootWriteAdapter,
	reference: MosaicTextRootReference,
	start: number,
	end: number,
	inserted: string,
	state: RewriteState,
	counters: MutableCounters,
): Promise<readonly MosaicTextRootReference[]> => {
	const node = await readNode(writer, reference, counters)
	if (node.kind === `mosaic-text-root-leaf`) {
		if (start < 0 || end < start || end > node.text.length) {
			throw new RangeError(`A Mosaic Text v3 leaf edit is out of bounds.`)
		}
		const boundaries = new Set([0, node.text.length])
		visitGraphemes(node.text, (boundaryStart, boundaryEnd) => {
			boundaries.add(boundaryStart)
			boundaries.add(boundaryEnd)
		})
		counters.utf16Scanned += node.text.length
		if (!boundaries.has(start) || !boundaries.has(end)) {
			throw new Error(`A Mosaic Text v3 edit split a grapheme cluster.`)
		}
		const replacement = `${node.text.slice(0, start)}${
			state.inserted ? `` : inserted
		}${node.text.slice(end)}`
		state.inserted = true
		await writer.retire?.(reference.key)
		return stageLeaves(writer, replacement, counters)
	}

	const next: MosaicTextRootReference[] = []
	let cursor = 0
	let selectedCollapsedChild = false
	for (const child of node.children) {
		const childStart = cursor
		const childEnd = cursor + child.summary.utf16Units
		cursor = childEnd
		const overlaps =
			start === end
				? !selectedCollapsedChild && start >= childStart && start <= childEnd
				: end > childStart && start < childEnd
		if (!overlaps) {
			next.push(child)
			continue
		}
		selectedCollapsedChild = start === end
		next.push(
			...(await rewriteReference(
				writer,
				child,
				Math.max(0, start - childStart),
				Math.min(child.summary.utf16Units, end - childStart),
				inserted,
				state,
				counters,
			)),
		)
	}
	if (!state.inserted && start === node.summary.utf16Units) {
		next.push(...(await stageLeaves(writer, inserted, counters)))
		state.inserted = true
	}
	await writer.retire?.(reference.key)
	if (next.length === 0) return []
	return stageBranchLevel(writer, next, node.depth, counters)
}

/** Path-copy one grapheme-safe UTF-16 replacement. */
export async function stageMosaicTextRootReplace(
	writer: MosaicTextRootWriteAdapter,
	root: MosaicTextRoot,
	range: { readonly end: number; readonly start: number },
	inserted: string,
): Promise<MosaicTextRootMutation> {
	const length = root.reference?.summary.utf16Units ?? 0
	if (
		root.version !== MOSAIC_TEXT_ROOT_PROTOCOL_VERSION ||
		!Number.isSafeInteger(root.generation) ||
		root.generation < 1 ||
		!Number.isSafeInteger(range.start) ||
		!Number.isSafeInteger(range.end) ||
		range.start < 0 ||
		range.end < range.start ||
		range.end > length
	) {
		throw new RangeError(`Invalid Mosaic Text v3 replacement range.`)
	}
	const counters = emptyCounters()
	let references: readonly MosaicTextRootReference[]
	if (root.reference === null) {
		references = await stageLeaves(writer, inserted, counters)
	} else {
		references = await rewriteReference(
			writer,
			root.reference,
			range.start,
			range.end,
			inserted,
			{ inserted: false },
			counters,
		)
	}
	return {
		counters,
		root: {
			generation: root.generation + 1,
			reference: await rootFromReferences(writer, references, counters),
			version: MOSAIC_TEXT_ROOT_PROTOCOL_VERSION,
		},
	}
}

export function createMosaicTextRootReader(
	reader: MosaicTextRootReadAdapter,
): MosaicTextRootReader {
	return {
		async resolveUtf16Boundary(
			root: MosaicTextRoot,
			offset: number,
			affinity: `left` | `right`,
			limit = 128,
		): Promise<{
			readonly counters: MosaicTextRootCounters
			readonly offset: number
		}> {
			const length = root.reference?.summary.utf16Units ?? 0
			if (
				!Number.isSafeInteger(offset) ||
				offset < 0 ||
				offset > length ||
				(affinity !== `left` && affinity !== `right`) ||
				!Number.isSafeInteger(limit) ||
				limit < 1
			) {
				throw new RangeError(`Invalid Mosaic Text v3 boundary lookup.`)
			}
			const counters = emptyCounters()
			if (offset === 0 || offset === length || root.reference === null) {
				return { counters, offset }
			}
			const visit = async (
				reference: MosaicTextRootReference,
				localOffset: number,
				absoluteStart: number,
			): Promise<number> => {
				if (counters.objectReads >= limit) {
					throw new Error(
						`Mosaic Text v3 boundary lookup exceeded ${limit} objects.`,
					)
				}
				const node = await readNode(reader, reference, counters)
				if (node.kind === `mosaic-text-root-leaf`) {
					let left = 0
					let right = node.text.length
					visitGraphemes(node.text, (start, end) => {
						if (end <= localOffset) left = end
						if (start >= localOffset && right === node.text.length) right = start
					})
					counters.utf16Scanned += node.text.length
					if (left === localOffset || right === localOffset) {
						return absoluteStart + localOffset
					}
					return absoluteStart + (affinity === `left` ? left : right)
				}
				let cursor = 0
				for (const child of node.children) {
					const childEnd = cursor + child.summary.utf16Units
					if (localOffset === cursor || localOffset === childEnd) {
						return absoluteStart + localOffset
					}
					if (localOffset < childEnd) {
						return visit(child, localOffset - cursor, absoluteStart + cursor)
					}
					cursor = childEnd
				}
				throw new Error(`Invalid Mosaic Text v3 boundary path.`)
			}
			return {
				counters,
				offset: await visit(root.reference, offset, 0),
			}
		},
		async readRange(
			root: MosaicTextRoot,
			range: { readonly end: number; readonly start: number },
			limit = 128,
		): Promise<{
			readonly counters: MosaicTextRootCounters
			readonly text: string
		}> {
			const length = root.reference?.summary.utf16Units ?? 0
			if (
				!Number.isSafeInteger(range.start) ||
				!Number.isSafeInteger(range.end) ||
				range.start < 0 ||
				range.end < range.start ||
				range.end > length ||
				!Number.isSafeInteger(limit) ||
				limit < 1
			) {
				throw new RangeError(`Invalid Mosaic Text v3 read range.`)
			}
			const counters = emptyCounters()
			const chunks: string[] = []
			const visit = async (
				reference: MosaicTextRootReference,
				start: number,
				end: number,
			): Promise<void> => {
				if (counters.objectReads >= limit) {
					throw new Error(
						`Mosaic Text v3 range hydration exceeded ${limit} objects.`,
					)
				}
				const node = await readNode(reader, reference, counters)
				if (node.kind === `mosaic-text-root-leaf`) {
					chunks.push(node.text.slice(start, end))
					counters.utf16Scanned += end - start
					return
				}
				let cursor = 0
				for (const child of node.children) {
					const childStart = cursor
					const childEnd = cursor + child.summary.utf16Units
					cursor = childEnd
					if (end <= childStart || start >= childEnd) continue
					await visit(
						child,
						Math.max(0, start - childStart),
						Math.min(child.summary.utf16Units, end - childStart),
					)
				}
			}
			if (root.reference !== null && range.end > range.start) {
				await visit(root.reference, range.start, range.end)
			}
			return { counters, text: chunks.join(``) }
		},
	}
}
