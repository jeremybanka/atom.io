import { Subject } from "atom.io/foundations/subject"

import type {
	MosaicModelDecision,
	MosaicOperationSignal,
	MosaicPrepareContext,
	MosaicReduceContext,
	MosaicTransceiver,
	MosaicTransceiverConstructor,
} from "./transceiver.ts"

export type MosaicTextNode = {
	readonly after: string | null
	/** The retained right boundary of the insertion interval. */
	readonly before: string | null
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
	readonly dependencies: readonly string[]
	readonly group: string
	readonly id: string
	readonly operation: MosaicTextOperation
	readonly revision: number | null
	readonly session: string
}

export type MosaicTextState = {
	readonly actions: readonly MosaicTextAppliedOperation[]
	readonly activeEdits: Readonly<Record<string, boolean>>
	readonly nodes: Readonly<Record<string, MosaicTextNode>>
}

export type MosaicTextSnapshot = MosaicTextState

export type MosaicTextRelativePosition = {
	readonly affinity: `left` | `right`
	readonly leftId: string | null
	readonly rightId: string | null
}

export type MosaicTextSelection = {
	readonly anchor: MosaicTextRelativePosition
	readonly head: MosaicTextRelativePosition
}

export type MosaicTextHistoryGroup = {
	readonly group: string
	readonly targetOperationIds: readonly string[]
}

export type MosaicTextHistory = {
	readonly redo: readonly MosaicTextHistoryGroup[]
	readonly undo: readonly MosaicTextHistoryGroup[]
}

export type MosaicTextView = {
	readonly historyFor: (actor: string) => MosaicTextHistory
	readonly length: number
	readonly nodes: readonly MosaicTextNode[]
	readonly positionAtOffset: (offset: number) => MosaicTextRelativePosition
	readonly resolvePosition: (position: MosaicTextRelativePosition) => number
	readonly selectionFromOffsets: (
		anchor: number,
		head: number,
	) => MosaicTextSelection
	readonly subscribe: (
		key: string,
		fn: (signal: MosaicOperationSignal<MosaicTextOperation>) => void,
	) => () => void
	readonly text: string
}

export interface MosaicTextTransceiver
	extends
		MosaicTransceiver<
			MosaicTextView,
			MosaicTextIntent,
			MosaicTextOperation,
			MosaicTextSnapshot
		>,
		Omit<MosaicTextView, `subscribe`> {}

export type MosaicTextConstructor =
	MosaicTransceiverConstructor<MosaicTextTransceiver>

export type MosaicTextOptions = {
	readonly initialText?: string
	readonly maximumGraphemes?: number
}

type EditDraft = {
	after: string | null
	before: string | null
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
	const duplicate = state.actions.find(({ id }) => id === context.id)
	if (duplicate !== undefined) {
		if (
			duplicate.actor !== context.actor ||
			duplicate.group !== (context.group ?? context.id) ||
			duplicate.session !== context.session ||
			JSON.stringify(duplicate.operation) !== JSON.stringify(operation)
		) {
			throw new Error(`Mosaic operation id collision: ${context.id}`)
		}
		return state
	}
	const group = context.group ?? context.id
	const actions = [
		...state.actions,
		{
			actor: context.actor,
			dependencies: context.dependencies,
			group,
			id: context.id,
			operation,
			revision: context.revision,
			session: context.session,
		},
	].sort((left, right) => {
		if (left.revision !== null && right.revision !== null) {
			return left.revision - right.revision
		}
		if (left.revision !== null) return -1
		if (right.revision !== null) return 1
		return compareMosaicIds(left.id, right.id)
	})
	const next: MosaicTextState = {
		actions,
		activeEdits: {},
		nodes: { ...state.nodes },
	}
	if (operation.type === `edit`) {
		for (const node of operation.inserted) {
			;(next.nodes as Record<string, MosaicTextNode>)[node.id] = {
				...node,
				createdBy: context.id,
			}
		}
	}
	const activeEdits = next.activeEdits as Record<string, boolean>
	for (const action of actions) {
		if (action.operation.type === `edit`) activeEdits[action.id] = true
		else {
			const active = action.operation.mode === `redo`
			for (const target of action.operation.targetOperationIds) {
				activeEdits[target] = active
			}
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
	const isWithin = (candidate: string | null, root: string): boolean => {
		let cursor = candidate
		const seen = new Set<string>()
		while (cursor !== null && !seen.has(cursor)) {
			if (cursor === root) return true
			seen.add(cursor)
			cursor = state.nodes[cursor]?.after ?? null
		}
		return false
	}
	for (const siblings of children.values()) {
		siblings.sort((left, right) => {
			const leftBeforeRight = isWithin(left.before, right.id)
			const rightBeforeLeft = isWithin(right.before, left.id)
			if (leftBeforeRight !== rightBeforeLeft) return leftBeforeRight ? -1 : 1
			return compareMosaicIds(left.id, right.id)
		})
	}
	const ordered: MosaicTextNode[] = []
	const visited = new Set<string>()
	const stack = [...(children.get(null) ?? [])].reverse()
	while (stack.length > 0) {
		const node = stack.pop()!
		if (visited.has(node.id)) continue
		visited.add(node.id)
		ordered.push(node)
		// Descendants remain traversable when their anchor is hidden. Push them in
		// reverse so the iterative traversal preserves the recursive DFS order.
		const descendants = children.get(node.id) ?? []
		for (let index = descendants.length - 1; index >= 0; index--) {
			stack.push(descendants[index])
		}
	}
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
		before: visible[visible.length - suffix]?.id ?? null,
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

export function deriveMosaicTextHistory(
	state: MosaicTextState,
	actor: string,
): MosaicTextHistory {
	const undo: MosaicTextHistoryGroup[] = []
	const redo: MosaicTextHistoryGroup[] = []
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
		const targets = action.operation.targetOperationIds
		const index = from.findLastIndex((candidate) =>
			sameTargets(candidate.targetOperationIds, targets),
		)
		if (index !== -1) {
			const group = from.splice(index, 1)[0]
			to.push(group)
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
					before: draft.before,
					id: `${context.id}:node:${index.toString().padStart(6, `0`)}`,
					value,
				}
				after = node.id
				return node
			},
		)
		return { deletedIds: draft.deletedIds, inserted, type: `edit` }
	}
	const target = deriveMosaicTextHistory(state, context.actor)[intent.type].at(
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
	value: unknown,
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
		const knownBeforeOperation = new Set(known)
		const orderedBeforeOperation = orderedNodes(state)
		const acceptedOperationIds = new Set(state.actions.map(({ id }) => id))
		const missingDependencies = context.dependencies.filter(
			(dependency) => !acceptedOperationIds.has(dependency),
		)
		// Dependencies name immediate frontier operations, while anchors name model
		// nodes. A missing node can be owned by a transitive ancestor of any missing
		// frontier operation, so it is only definitely invalid after that frontier
		// has been applied. Return only its unresolved operation IDs for retry.
		const inserted: MosaicTextInsertedNode[] = []
		for (const [index, candidate] of operation[`inserted`].entries()) {
			if (!isRecord(candidate)) {
				return {
					reason: `Malformed inserted grapheme.`,
					status: `reject` as const,
				}
			}
			const { after, before, id, value: grapheme } = candidate
			const expectedAfter = index === 0 ? after : inserted[index - 1].id
			if (
				!isId(id) ||
				!id.startsWith(`${context.id}:node:`) ||
				id !== `${context.id}:node:${index.toString().padStart(6, `0`)}` ||
				(after !== null && !isId(after)) ||
				(before !== null && !isId(before)) ||
				after !== expectedAfter ||
				(after !== null && after === before) ||
				typeof grapheme !== `string` ||
				grapheme.length > 1_024 ||
				splitMosaicText(grapheme).length !== 1 ||
				known.has(id)
			) {
				return {
					reason: `Invalid inserted grapheme chain.`,
					status: `reject` as const,
				}
			}
			if (after !== null && !known.has(after)) {
				return missingDependencies.length === 0
					? { reason: `Unknown predecessor anchor.`, status: `reject` as const }
					: { dependencies: missingDependencies, status: `defer` as const }
			}
			if (before !== null && !knownBeforeOperation.has(before)) {
				return missingDependencies.length === 0
					? { reason: `Unknown successor anchor.`, status: `reject` as const }
					: { dependencies: missingDependencies, status: `defer` as const }
			}
			if (index === 0) {
				const leftIndex =
					after === null
						? -1
						: orderedBeforeOperation.findIndex(
								({ id: nodeId }) => nodeId === after,
							)
				const rightIndex =
					before === null
						? orderedBeforeOperation.length
						: orderedBeforeOperation.findIndex(
								({ id: nodeId }) => nodeId === before,
							)
				if (leftIndex >= rightIndex) {
					return {
						reason: `The insertion interval is inverted.`,
						status: `reject` as const,
					}
				}
			}
			known.add(id)
			inserted.push({ after, before, id, value: grapheme })
		}
		if (
			!operation[`deletedIds`].every(isId) ||
			new Set(operation[`deletedIds`]).size !== operation[`deletedIds`].length
		) {
			return { reason: `Malformed deletion targets.`, status: `reject` as const }
		}
		if (operation[`deletedIds`].some((id) => !state.nodes[id])) {
			return missingDependencies.length === 0
				? { reason: `Unknown deletion target.`, status: `reject` as const }
				: { dependencies: missingDependencies, status: `defer` as const }
		}
		const normalized: MosaicTextEditOperation = {
			deletedIds: [...operation[`deletedIds`]],
			inserted,
			type: `edit` as const,
		}
		const prospective = applyTextOperation(state, normalized, context)
		if (visibleMosaicTextNodes(prospective).length > maximumGraphemes) {
			return {
				reason: `The text exceeds its grapheme capacity.`,
				status: `reject` as const,
			}
		}
		return {
			operation: normalized,
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
		const expected = deriveMosaicTextHistory(state, context.actor)[mode].at(-1)
		if (
			expected === undefined ||
			!sameTargets(expected.targetOperationIds, operation[`targetOperationIds`])
		) {
			return {
				code: `stale-history`,
				reason: `The actor history cursor is stale.`,
				recovery: `resnapshot`,
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

function hydrateMosaicText(
	snapshot: unknown,
	maximumGraphemes: number,
): MosaicTextState {
	if (!isRecord(snapshot) || !Array.isArray(snapshot[`actions`])) {
		throw new Error(`Invalid Mosaic text snapshot`)
	}
	let state = createEmptyMosaicText()
	for (const candidate of snapshot[`actions`]) {
		if (!isRecord(candidate)) throw new Error(`Invalid Mosaic text snapshot`)
		const { actor, dependencies, group, id, operation, revision, session } =
			candidate
		if (
			!isId(actor) ||
			!Array.isArray(dependencies) ||
			!dependencies.every(isId) ||
			!isId(group) ||
			!isId(id) ||
			!isId(session) ||
			(revision !== null &&
				(!Number.isSafeInteger(revision) || (revision as number) < 0))
		) {
			throw new Error(`Invalid Mosaic text snapshot`)
		}
		const context: MosaicReduceContext = {
			actor,
			dependencies,
			group,
			id,
			revision: revision as number | null,
			session,
		}
		const decision = validateTextOperation(
			state,
			operation,
			context,
			maximumGraphemes,
		)
		if (decision.status !== `accept`) {
			throw new Error(
				`Invalid Mosaic text snapshot: ${
					decision.status === `reject`
						? decision.reason
						: `missing dependencies ${decision.dependencies.join(`, `)}`
				}`,
			)
		}
		state = applyTextOperation(state, decision.operation, context)
	}
	return state
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
				before: null,
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
		{
			actor: `system`,
			dependencies: [],
			group: id,
			id,
			revision: 0,
			session: `system`,
		},
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
			return {
				affinity: `right`,
				leftId: visible[index - 1]?.id ?? null,
				rightId: node.id,
			}
		}
		if (utf16Offset < end) {
			return {
				affinity: `left`,
				leftId: node.id,
				rightId: visible[index + 1]?.id ?? null,
			}
		}
		offset = end
	}
	return {
		affinity: `left`,
		leftId: visible.at(-1)?.id ?? null,
		rightId: null,
	}
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
	if (position.affinity === `right` && position.rightId !== null) {
		const right = offsets.get(position.rightId)
		if (right !== undefined) return right
	}
	if (position.leftId !== null) {
		const left = offsets.get(position.leftId)
		const node = state.nodes[position.leftId]
		if (left !== undefined && node !== undefined) return left + node.value.length
	}
	if (position.rightId !== null) {
		const right = offsets.get(position.rightId)
		if (right !== undefined) return right
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

/** Create the built-in convergent Unicode text transceiver class. */
export function mosaicText(
	options: MosaicTextOptions = {},
): MosaicTextConstructor {
	const initialText = options.initialText ?? ``
	const maximumGraphemes = options.maximumGraphemes ?? 200_000
	const configuration = { initialText, maximumGraphemes }
	if (!Number.isSafeInteger(maximumGraphemes) || maximumGraphemes < 1) {
		throw new Error(`maximumGraphemes must be a positive safe integer`)
	}
	if (
		initialText.length > maximumGraphemes * 1_024 ||
		splitMosaicText(initialText).length > maximumGraphemes
	) {
		throw new Error(`initialText exceeds maximumGraphemes`)
	}

	class MosaicText implements MosaicTextTransceiver {
		public static readonly mosaic = {
			configuration,
			key: `text`,
			version: 1,
		} as const
		public static readonly timelinePolicy = `append-only` as const

		readonly #subject = new Subject<MosaicOperationSignal<MosaicTextOperation>>()
		#state = createSeededText(initialText)

		public readonly READONLY_VIEW: MosaicTextView = this

		public historyFor(actor: string): MosaicTextHistory {
			return deriveMosaicTextHistory(this.#state, actor)
		}

		public get length(): number {
			return this.text.length
		}

		public get nodes(): readonly MosaicTextNode[] {
			return visibleMosaicTextNodes(this.#state)
		}

		public get text(): string {
			return materializeMosaicText(this.#state)
		}

		public change(
			intent: MosaicTextIntent,
			context: MosaicPrepareContext,
		): MosaicOperationSignal<MosaicTextOperation> | null {
			const operation = prepareText(this.#state, intent, context)
			if (operation === null) return null
			const signal: MosaicOperationSignal<MosaicTextOperation> = {
				actor: context.actor,
				dependencies: context.dependencies,
				group: context.group,
				id: context.id,
				operation,
				revision: null,
				session: context.session,
			}
			this.do(signal)
			this.#subject.next(signal)
			return signal
		}

		public do(signal: MosaicOperationSignal<MosaicTextOperation>): null {
			const context: MosaicReduceContext = {
				actor: signal.actor,
				dependencies: signal.dependencies,
				group: signal.group,
				id: signal.id,
				revision: signal.revision,
				session: signal.session,
			}
			if (this.#state.actions.some(({ id }) => id === signal.id)) {
				this.#state = applyTextOperation(this.#state, signal.operation, context)
				return null
			}
			const decision = this.validate(signal.operation, context)
			if (decision.status === `defer`) {
				throw new Error(
					`Mosaic text operation is missing dependencies: ${decision.dependencies.join(`, `)}`,
				)
			}
			if (decision.status === `reject`) {
				throw new Error(`Invalid Mosaic text operation: ${decision.reason}`)
			}
			this.#state = applyTextOperation(this.#state, decision.operation, context)
			return null
		}

		public positionAtOffset(offset: number): MosaicTextRelativePosition {
			return positionAtMosaicTextOffset(this.#state, offset)
		}

		public resolvePosition(position: MosaicTextRelativePosition): number {
			return resolveMosaicTextPosition(this.#state, position)
		}

		public selectionFromOffsets(
			anchor: number,
			head: number,
		): MosaicTextSelection {
			return {
				anchor: positionAtMosaicTextOffset(this.#state, anchor),
				head: positionAtMosaicTextOffset(this.#state, head),
			}
		}

		public subscribe(
			key: string,
			fn: (signal: MosaicOperationSignal<MosaicTextOperation>) => void,
		): () => void {
			return this.#subject.subscribe(key, fn)
		}

		public toJSON(): MosaicTextSnapshot {
			return structuredClone(this.#state)
		}

		public undo(_signal: MosaicOperationSignal<MosaicTextOperation>): never {
			throw new Error(
				`Mosaic text is append-only. Append actor-scoped history operations instead of rewinding it.`,
			)
		}

		public validate(
			operation: unknown,
			context: MosaicReduceContext,
		): MosaicModelDecision<MosaicTextOperation> {
			return validateTextOperation(
				this.#state,
				operation,
				context,
				maximumGraphemes,
			)
		}

		public static fromJSON(snapshot: MosaicTextSnapshot): MosaicText {
			const text = new MosaicText()
			text.#state = hydrateMosaicText(snapshot, maximumGraphemes)
			return text
		}
	}

	return MosaicText
}
