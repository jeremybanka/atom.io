import type {
	MosaicModel,
	MosaicModelDecision,
	MosaicPrepareContext,
	MosaicReduceContext,
} from "./resource.ts"
import { defineMosaicModel } from "./resource.ts"

export type MosaicTextNode = {
	readonly after: string | null
	readonly createdBy: string
	readonly id: string
	readonly value: string
}

export type MosaicTextInsertedNode = Omit<MosaicTextNode, `createdBy`>

export type MosaicTextEditOperation = {
	readonly deletedIds: readonly string[]
	readonly inserted: readonly MosaicTextInsertedNode[]
	readonly type: `edit`
}

export type MosaicTextHistoryOperation = {
	readonly mode: `redo` | `undo`
	readonly targetOperationIds: readonly string[]
	readonly type: `history`
}

export type MosaicTextOperation =
	| MosaicTextEditOperation
	| MosaicTextHistoryOperation

export type MosaicTextIntent =
	| { readonly text: string; readonly type: `replace-text` }
	| { readonly type: `redo` }
	| { readonly type: `undo` }

export type MosaicTextAppliedOperation = {
	readonly actor: string
	readonly group: string
	readonly id: string
	readonly operation: MosaicTextOperation
}

export type MosaicTextState = {
	readonly actions: readonly MosaicTextAppliedOperation[]
	readonly activeEdits: Readonly<Record<string, boolean>>
	readonly nodes: Readonly<Record<string, MosaicTextNode>>
}

export type MosaicTextSnapshot = MosaicTextState

export type MosaicTextRelativePosition = {
	readonly leftId: string | null
	readonly rightId: string | null
}

export type MosaicTextSelection = {
	readonly anchor: MosaicTextRelativePosition
	readonly head: MosaicTextRelativePosition
}

export type MosaicTextTimelineGroup = {
	readonly group: string
	readonly targetOperationIds: readonly string[]
}

export type MosaicTextTimeline = {
	readonly redo: readonly MosaicTextTimelineGroup[]
	readonly undo: readonly MosaicTextTimelineGroup[]
}

export type MosaicTextModel = MosaicModel<
	MosaicTextState,
	MosaicTextIntent,
	MosaicTextOperation,
	MosaicTextSnapshot
> & {
	readonly fromText: (text: string) => MosaicTextState
	readonly positionAtOffset: (
		state: MosaicTextState,
		offset: number,
	) => MosaicTextRelativePosition
	readonly resolvePosition: (
		state: MosaicTextState,
		position: MosaicTextRelativePosition,
	) => number
	readonly selectionFromOffsets: (
		state: MosaicTextState,
		anchor: number,
		head: number,
	) => MosaicTextSelection
	readonly text: (state: MosaicTextState) => string
	readonly timeline: (
		state: MosaicTextState,
		actor: string,
	) => MosaicTextTimeline
	readonly visibleNodes: (state: MosaicTextState) => readonly MosaicTextNode[]
}

export type MosaicTextOptions = {
	readonly initialText?: string
	readonly maximumGraphemes?: number
}

type EditDraft = {
	after: string | null
	deletedIds: string[]
	insertedValues: string[]
}

const segmenter = new Intl.Segmenter(undefined, { granularity: `grapheme` })

/** Split text into the Unicode graphemes used by Mosaic Text model version 1. */
export function splitMosaicText(text: string): string[] {
	return Array.from(segmenter.segment(text), ({ segment }) => segment)
}

/** Locale-independent ordering required for convergence across runtimes. */
export function compareMosaicIds(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0
}

export function createEmptyMosaicText(): MosaicTextState {
	return { actions: [], activeEdits: {}, nodes: {} }
}

function applyTextOperation(
	state: MosaicTextState,
	operation: MosaicTextOperation,
	context: MosaicReduceContext,
): MosaicTextState {
	if (state.actions.some(({ id }) => id === context.id)) return state
	const group = context.group ?? context.id
	const next: MosaicTextState = {
		actions: [
			...state.actions,
			{ actor: context.actor, group, id: context.id, operation },
		],
		activeEdits: { ...state.activeEdits },
		nodes: { ...state.nodes },
	}
	if (operation.type === `edit`) {
		for (const node of operation.inserted) {
			;(next.nodes as Record<string, MosaicTextNode>)[node.id] = {
				...node,
				createdBy: context.id,
			}
		}
		;(next.activeEdits as Record<string, boolean>)[context.id] = true
	} else {
		const active = operation.mode === `redo`
		for (const target of operation.targetOperationIds) {
			;(next.activeEdits as Record<string, boolean>)[target] = active
		}
	}
	return next
}

function orderedNodes(state: MosaicTextState): MosaicTextNode[] {
	const children = new Map<string | null, MosaicTextNode[]>()
	for (const node of Object.values(state.nodes)) {
		const siblings = children.get(node.after) ?? []
		siblings.push(node)
		children.set(node.after, siblings)
	}
	for (const siblings of children.values()) {
		siblings.sort((left, right) => compareMosaicIds(left.id, right.id))
	}
	const ordered: MosaicTextNode[] = []
	const visited = new Set<string>()
	const visit = (after: string | null): void => {
		for (const node of children.get(after) ?? []) {
			if (visited.has(node.id)) continue
			visited.add(node.id)
			ordered.push(node)
			// Descendants remain traversable when their anchor is hidden.
			visit(node.id)
		}
	}
	visit(null)
	return ordered
}

export function visibleMosaicTextNodes(
	state: MosaicTextState,
): MosaicTextNode[] {
	const deleted = new Set<string>()
	for (const action of state.actions) {
		if (
			action.operation.type !== `edit` ||
			state.activeEdits[action.id] !== true
		) {
			continue
		}
		for (const id of action.operation.deletedIds) deleted.add(id)
	}
	return orderedNodes(state).filter(
		(node) =>
			state.activeEdits[node.createdBy] === true && !deleted.has(node.id),
	)
}

export function materializeMosaicText(state: MosaicTextState): string {
	return visibleMosaicTextNodes(state)
		.map(({ value }) => value)
		.join(``)
}

function diffText(state: MosaicTextState, nextText: string): EditDraft | null {
	const visible = visibleMosaicTextNodes(state)
	const previous = visible.map(({ value }) => value)
	const next = splitMosaicText(nextText)
	let prefix = 0
	while (
		prefix < previous.length &&
		prefix < next.length &&
		previous[prefix] === next[prefix]
	) {
		prefix++
	}
	let suffix = 0
	while (
		suffix < previous.length - prefix &&
		suffix < next.length - prefix &&
		previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
	) {
		suffix++
	}
	const deleted = visible.slice(prefix, visible.length - suffix)
	const insertedValues = next.slice(prefix, next.length - suffix)
	if (deleted.length === 0 && insertedValues.length === 0) return null
	return {
		after: visible[prefix - 1]?.id ?? null,
		deletedIds: deleted.map(({ id }) => id),
		insertedValues,
	}
}

function sameTargets(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((target, index) => target === right[index])
	)
}

export function deriveMosaicTextTimeline(
	state: MosaicTextState,
	actor: string,
): MosaicTextTimeline {
	const undo: MosaicTextTimelineGroup[] = []
	const redo: MosaicTextTimelineGroup[] = []
	for (const action of state.actions) {
		if (action.actor !== actor) continue
		if (action.operation.type === `edit`) {
			const previous = undo.at(-1)
			if (previous?.group === action.group) {
				;(previous.targetOperationIds as string[]).push(action.id)
			} else {
				undo.push({ group: action.group, targetOperationIds: [action.id] })
			}
			redo.length = 0
			continue
		}
		const from = action.operation.mode === `undo` ? undo : redo
		const to = action.operation.mode === `undo` ? redo : undo
		const index = from.findLastIndex((candidate) =>
			sameTargets(
				candidate.targetOperationIds,
				action.operation.type === `history`
					? action.operation.targetOperationIds
					: [],
			),
		)
		if (index !== -1) {
			const [group] = from.splice(index, 1)
			if (group) to.push(group)
		}
	}
	return { redo, undo }
}

function prepareText(
	state: MosaicTextState,
	intent: MosaicTextIntent,
	context: MosaicPrepareContext,
): MosaicTextOperation | null {
	if (intent.type === `replace-text`) {
		const draft = diffText(state, intent.text)
		if (draft === null) return null
		let after = draft.after
		const inserted = draft.insertedValues.map(
			(value, index): MosaicTextInsertedNode => {
				const node = {
					after,
					id: `${context.id}:node:${index.toString().padStart(6, `0`)}`,
					value,
				}
				after = node.id
				return node
			},
		)
		return { deletedIds: draft.deletedIds, inserted, type: `edit` }
	}
	const target = deriveMosaicTextTimeline(state, context.actor)[intent.type].at(
		-1,
	)
	return target === undefined
		? null
		: {
				mode: intent.type,
				targetOperationIds: target.targetOperationIds,
				type: `history`,
			}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === `object` && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is string {
	return typeof value === `string` && value.length > 0 && value.length <= 512
}

function validateTextOperation(
	state: MosaicTextState,
	value: MosaicTextOperation,
	context: MosaicReduceContext,
	maximumGraphemes: number,
): MosaicModelDecision<MosaicTextOperation> {
	const operation: unknown = value
	if (!isRecord(operation))
		return { reason: `Operation must be an object.`, status: `reject` as const }
	if (operation[`type`] === `edit`) {
		if (
			!Array.isArray(operation[`inserted`]) ||
			!Array.isArray(operation[`deletedIds`]) ||
			operation[`inserted`].length + operation[`deletedIds`].length >
				maximumGraphemes
		) {
			return { reason: `Malformed text edit.`, status: `reject` as const }
		}
		const known = new Set(Object.keys(state.nodes))
		const inserted: MosaicTextInsertedNode[] = []
		for (const [index, candidate] of operation[`inserted`].entries()) {
			if (!isRecord(candidate)) {
				return {
					reason: `Malformed inserted grapheme.`,
					status: `reject` as const,
				}
			}
			const { after, id, value: grapheme } = candidate
			if (
				!isId(id) ||
				!id.startsWith(`${context.id}:node:`) ||
				id !== `${context.id}:node:${index.toString().padStart(6, `0`)}` ||
				(after !== null && !isId(after)) ||
				typeof grapheme !== `string` ||
				splitMosaicText(grapheme).length !== 1 ||
				known.has(id)
			) {
				return {
					reason: `Invalid inserted grapheme chain.`,
					status: `reject` as const,
				}
			}
			if (after !== null && !known.has(after)) {
				return context.dependencies.length === 0
					? { reason: `Unknown predecessor anchor.`, status: `reject` as const }
					: { dependencies: context.dependencies, status: `defer` as const }
			}
			known.add(id)
			inserted.push({ after, id, value: grapheme })
		}
		if (
			!operation[`deletedIds`].every(isId) ||
			new Set(operation[`deletedIds`]).size !== operation[`deletedIds`].length
		) {
			return { reason: `Malformed deletion targets.`, status: `reject` as const }
		}
		if (operation[`deletedIds`].some((id) => !state.nodes[id])) {
			return context.dependencies.length === 0
				? { reason: `Unknown deletion target.`, status: `reject` as const }
				: { dependencies: context.dependencies, status: `defer` as const }
		}
		return {
			operation: {
				deletedIds: [...operation[`deletedIds`]],
				inserted,
				type: `edit` as const,
			},
			status: `accept` as const,
		}
	}
	if (operation[`type`] === `history`) {
		if (
			(operation[`mode`] !== `undo` && operation[`mode`] !== `redo`) ||
			!Array.isArray(operation[`targetOperationIds`]) ||
			operation[`targetOperationIds`].length === 0 ||
			!operation[`targetOperationIds`].every(isId)
		) {
			return {
				reason: `Malformed history operation.`,
				status: `reject` as const,
			}
		}
		const mode = operation[`mode`]
		const expected = deriveMosaicTextTimeline(state, context.actor)[mode].at(-1)
		if (
			expected === undefined ||
			!sameTargets(expected.targetOperationIds, operation[`targetOperationIds`])
		) {
			return {
				reason: `The actor history cursor is stale.`,
				status: `reject` as const,
			}
		}
		return {
			operation: {
				mode,
				targetOperationIds: [...operation[`targetOperationIds`]],
				type: `history` as const,
			},
			status: `accept` as const,
		}
	}
	return { reason: `Unknown text operation type.`, status: `reject` as const }
}

function createSeededText(text: string): MosaicTextState {
	let state = createEmptyMosaicText()
	if (text.length === 0) return state
	const id = `mosaic:text:seed`
	let after: string | null = null
	const inserted = splitMosaicText(text).map(
		(value, index): MosaicTextInsertedNode => {
			const node = {
				after,
				id: `${id}:node:${index.toString().padStart(6, `0`)}`,
				value,
			}
			after = node.id
			return node
		},
	)
	state = applyTextOperation(
		state,
		{ deletedIds: [], inserted, type: `edit` },
		{ actor: `system`, dependencies: [], group: id, id, session: `system` },
	)
	return state
}

export function positionAtMosaicTextOffset(
	state: MosaicTextState,
	utf16Offset: number,
): MosaicTextRelativePosition {
	const visible = visibleMosaicTextNodes(state)
	let offset = 0
	for (const [index, node] of visible.entries()) {
		const end = offset + node.value.length
		if (utf16Offset <= offset) {
			return { leftId: visible[index - 1]?.id ?? null, rightId: node.id }
		}
		if (utf16Offset < end) {
			return { leftId: node.id, rightId: visible[index + 1]?.id ?? null }
		}
		offset = end
	}
	return { leftId: visible.at(-1)?.id ?? null, rightId: null }
}

export function resolveMosaicTextPosition(
	state: MosaicTextState,
	position: MosaicTextRelativePosition,
): number {
	const ordered = orderedNodes(state)
	const visible = visibleMosaicTextNodes(state)
	const offsets = new Map<string, number>()
	let offset = 0
	for (const node of visible) {
		offsets.set(node.id, offset)
		offset += node.value.length
	}
	if (position.rightId !== null) {
		const right = offsets.get(position.rightId)
		if (right !== undefined) return right
	}
	if (position.leftId !== null) {
		const left = offsets.get(position.leftId)
		const node = state.nodes[position.leftId]
		if (left !== undefined && node !== undefined) return left + node.value.length
	}
	const anchorIndex = Math.max(
		position.rightId === null
			? -1
			: ordered.findIndex(({ id }) => id === position.rightId),
		position.leftId === null
			? -1
			: ordered.findIndex(({ id }) => id === position.leftId),
	)
	for (let index = anchorIndex + 1; index < ordered.length; index++) {
		const next = offsets.get(ordered[index].id)
		if (next !== undefined) return next
	}
	return offset
}

/** Create the built-in convergent Unicode text model. */
export function mosaicText(options: MosaicTextOptions = {}): MosaicTextModel {
	const initialText = options.initialText ?? ``
	const maximumGraphemes = options.maximumGraphemes ?? 200_000
	if (!Number.isSafeInteger(maximumGraphemes) || maximumGraphemes < 1) {
		throw new Error(`maximumGraphemes must be a positive safe integer`)
	}
	const base = defineMosaicModel({
		apply: applyTextOperation,
		create: () => createSeededText(initialText),
		hydrate: (snapshot: MosaicTextSnapshot) => structuredClone(snapshot),
		key: `text`,
		prepare: prepareText,
		snapshot: (state: MosaicTextState) => structuredClone(state),
		validate: (state, operation, context) =>
			validateTextOperation(state, operation, context, maximumGraphemes),
		version: 1,
	})
	return {
		...base,
		fromText: createSeededText,
		positionAtOffset: positionAtMosaicTextOffset,
		resolvePosition: resolveMosaicTextPosition,
		selectionFromOffsets: (state, anchor, head) => ({
			anchor: positionAtMosaicTextOffset(state, anchor),
			head: positionAtMosaicTextOffset(state, head),
		}),
		text: materializeMosaicText,
		timeline: deriveMosaicTextTimeline,
		visibleNodes: visibleMosaicTextNodes,
	}
}
