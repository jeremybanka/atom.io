import { Subject } from "atom.io/foundations/subject"

import {
	countMosaicTextGraphemes,
	visitMosaicTextGraphemes,
} from "./graphemes.ts"
import type {
	MosaicModelDecision,
	MosaicOperationSignal,
	MosaicPrepareContext,
	MosaicReduceContext,
	MosaicTransceiver,
	MosaicTransceiverConstructor,
} from "./transceiver.ts"

const MAXIMUM_GRAPHEME_UTF16_UNITS = 1_024
const MAXIMUM_LIMIT = 1_000_000
const MAXIMUM_UTF16_LIMIT = 32_000_000

export type MosaicTextBoundary = {
	/** A stable logical run identity, independent of checkpoint fragmentation. */
	readonly runId: string
	/** A Unicode-grapheme boundary in the logical run. */
	readonly offset: number
}

export type MosaicTextDeletionInterval = {
	readonly end: number
	readonly runId: string
	readonly start: number
}

export type MosaicTextInsertedRun = {
	readonly after: MosaicTextBoundary | null
	/** The retained right edge of the insertion interval. */
	readonly before: MosaicTextBoundary | null
	readonly id: string
	readonly text: string
}

export type MosaicTextEditOperation = {
	readonly deleted: readonly MosaicTextDeletionInterval[]
	readonly inserted: readonly MosaicTextInsertedRun[]
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
	| {
			readonly selection: MosaicTextSelection
			readonly text: string
			readonly type: `replace-selection`
	  }
	| { readonly type: `redo` }
	| { readonly type: `undo` }

export type MosaicTextRunFragment = {
	/** The first grapheme represented by this physical fragment. */
	readonly start: number
	readonly text: string
}

/**
 * One stable logical insertion. A checkpoint may split its text into physical
 * fragments without changing the run identity or any run-relative position.
 */
export type MosaicTextRun = {
	readonly after: MosaicTextBoundary | null
	readonly before: MosaicTextBoundary | null
	readonly createdBy: string
	readonly fragments: readonly MosaicTextRunFragment[]
	readonly graphemes: number
	readonly id: string
}

export type MosaicTextVisibleRun = {
	readonly createdBy: string
	readonly end: number
	readonly id: string
	readonly start: number
	readonly text: string
}

type MosaicTextCheckpointEditOperation = {
	readonly deleted: readonly MosaicTextDeletionInterval[]
	readonly insertedRunIds: readonly string[]
	readonly type: `edit`
}

type MosaicTextCheckpointOperation =
	| MosaicTextCheckpointEditOperation
	| MosaicTextHistoryOperation

export type MosaicTextAppliedOperation = {
	readonly actor: string
	readonly dependencies: readonly string[]
	/** The Domain gesture that owns this history unit. */
	readonly gestureId: string
	readonly id: string
	readonly operation: MosaicTextCheckpointOperation
	readonly revision: number | null
	readonly session: string
}

export type MosaicTextState = {
	readonly actions: readonly MosaicTextAppliedOperation[]
	readonly activeEdits: Readonly<Record<string, boolean>>
	readonly runs: Readonly<Record<string, MosaicTextRun>>
}

/** A compact, fragment-capable model checkpoint. */
export type MosaicTextSnapshot = {
	readonly actions: readonly MosaicTextAppliedOperation[]
	readonly runs: readonly MosaicTextRun[]
	readonly version: 2
}

export type MosaicTextRelativePosition = {
	readonly affinity: `left` | `right`
	readonly offset: number
	readonly runId: string | null
}

export type MosaicTextSelection = {
	readonly anchor: MosaicTextRelativePosition
	readonly head: MosaicTextRelativePosition
}

export type MosaicTextHistoryGroup = {
	readonly gestureId: string
	readonly targetOperationIds: readonly string[]
}

export type MosaicTextHistory = {
	readonly redo: readonly MosaicTextHistoryGroup[]
	readonly undo: readonly MosaicTextHistoryGroup[]
}

export type MosaicTextView = {
	readonly historyFor: (actor: string) => MosaicTextHistory
	/** UTF-16 length, matching DOM selection offsets and String.length. */
	readonly length: number
	readonly positionAtOffset: (offset: number) => MosaicTextRelativePosition
	readonly resolvePosition: (position: MosaicTextRelativePosition) => number
	/** Contiguous visible slices; never one durable object per grapheme. */
	readonly runs: readonly MosaicTextVisibleRun[]
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
		Omit<MosaicTextView, `subscribe`> {
	prepare(
		intent: MosaicTextIntent,
		context: MosaicPrepareContext,
	): MosaicOperationSignal<MosaicTextOperation> | null
	preview(
		signal: MosaicOperationSignal<MosaicTextOperation>,
	): readonly MosaicTextVisibleRun[]
}

export type MosaicTextConstructor =
	MosaicTransceiverConstructor<MosaicTextTransceiver> & {
		readonly domainHistory: {
			classify(operation: MosaicTextOperation):
				| { readonly kind: `change` }
				| {
						readonly kind: `compensation`
						readonly mode: `redo` | `undo`
						readonly targetOperationIds: readonly string[]
				  }
			compact(
				value: MosaicTextSnapshot,
				context: {
					readonly retainedOperationIds: ReadonlySet<string>
					readonly throughRevision: number
				},
			): MosaicTextSnapshot
			compensate(context: {
				readonly mode: `redo` | `undo`
				readonly targets: readonly { readonly id: string }[]
			}): MosaicTextHistoryOperation
		}
	}

export type MosaicTextOptions = {
	readonly initialText?: string
	readonly maximumDeletionIntervalsPerOperation?: number
	/** @deprecated Use maximumRunGraphemes. This alias is removed from model v3. */
	readonly maximumGraphemes?: number
	readonly maximumHistoryTargets?: number
	readonly maximumRunGraphemes?: number
	readonly maximumRunUtf16Units?: number
	readonly maximumRunsPerOperation?: number
}

export type MosaicTextSegmentFragment = MosaicTextRunFragment & {
	readonly runId: string
}

export type MosaicTextPhysicalSegment = {
	readonly fragments: readonly MosaicTextSegmentFragment[]
	readonly index: number
}

export type MosaicTextSegmentManifest = {
	readonly actions: readonly MosaicTextAppliedOperation[]
	readonly maximumFragmentsPerSegment: number
	readonly maximumGraphemesPerSegment: number
	readonly runs: readonly Omit<MosaicTextRun, `fragments`>[]
	readonly segmentCount: number
	readonly version: 1
}

export type MosaicTextSegmentBundle = {
	readonly manifest: MosaicTextSegmentManifest
	readonly segments: readonly MosaicTextPhysicalSegment[]
}

export type MosaicTextSegmentOptions = {
	readonly maximumFragmentsPerSegment?: number
	readonly maximumGraphemesPerSegment: number
}

type MosaicTextLimits = {
	maximumDeletionIntervalsPerOperation: number
	maximumHistoryTargets: number
	maximumRunGraphemes: number
	maximumRunUtf16Units: number
	maximumRunsPerOperation: number
}

type TextUnitArrays = {
	offsets: number[]
	runIds: string[]
	values: string[]
}

/** Split text into the Unicode graphemes used by Mosaic Text model version 2. */
export function splitMosaicText(text: string): string[] {
	const graphemes: string[] = []
	visitMosaicTextGraphemes(text, (start, end) =>
		graphemes.push(text.slice(start, end)),
	)
	return graphemes
}

/** Locale-independent ordering required for convergence across runtimes. */
export function compareMosaicIds(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0
}

/** Create the serialized empty checkpoint rather than runtime-only indexes. */
export function createEmptyMosaicText(): MosaicTextSnapshot {
	return { actions: [], runs: [], version: 2 }
}

function createEmptyState(): MosaicTextState {
	return { actions: [], activeEdits: {}, runs: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === `object` && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is string {
	return typeof value === `string` && value.length > 0 && value.length <= 512
}

function isBoundedInteger(value: unknown, maximum = MAXIMUM_LIMIT): boolean {
	return (
		Number.isSafeInteger(value) &&
		(value as number) >= 0 &&
		(value as number) <= maximum
	)
}

function sameBoundary(
	left: MosaicTextBoundary | null,
	right: MosaicTextBoundary | null,
): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.runId === right.runId &&
			left.offset === right.offset)
	)
}

function parseBoundary(value: unknown): MosaicTextBoundary | null | undefined {
	if (value === null) return null
	if (
		!isRecord(value) ||
		!isId(value[`runId`]) ||
		!isBoundedInteger(value[`offset`])
	) {
		return undefined
	}
	return { offset: value[`offset`] as number, runId: value[`runId`] }
}

const runIndexCache = new WeakMap<
	MosaicTextRun,
	{ readonly offsets: Uint32Array; readonly text: string }
>()

function indexRun(run: MosaicTextRun): {
	readonly offsets: Uint32Array
	readonly text: string
} {
	const cached = runIndexCache.get(run)
	if (cached !== undefined) return cached
	const text = [...run.fragments]
		.sort((left, right) => left.start - right.start)
		.map(({ text: fragment }) => fragment)
		.join(``)
	const graphemes = splitMosaicText(text)
	const offsets = new Uint32Array(graphemes.length + 1)
	for (const [index, grapheme] of graphemes.entries()) {
		offsets[index + 1] = offsets[index] + grapheme.length
	}
	const index = { offsets, text }
	runIndexCache.set(run, index)
	return index
}

function sliceRun(run: MosaicTextRun, start: number, end: number): string {
	if (
		start === 0 &&
		end === run.graphemes &&
		run.fragments.length === 1 &&
		run.fragments[0].start === 0
	) {
		return run.fragments[0].text
	}
	const { offsets, text } = indexRun(run)
	return text.slice(offsets[start], offsets[end])
}

function createRun(
	inserted: MosaicTextInsertedRun,
	createdBy: string,
): MosaicTextRun {
	const graphemes = countMosaicTextGraphemes(inserted.text)
	return {
		after: inserted.after,
		before: inserted.before,
		createdBy,
		fragments: [{ start: 0, text: inserted.text }],
		graphemes,
		id: inserted.id,
	}
}

function compareActions(
	left: MosaicTextAppliedOperation,
	right: MosaicTextAppliedOperation,
): number {
	if (left.revision !== null && right.revision !== null) {
		return left.revision - right.revision
	}
	if (left.revision !== null) return -1
	if (right.revision !== null) return 1
	// Array.sort is stable: provisional causal application order is preserved.
	return 0
}

function recomputeActiveEdits(
	actions: readonly MosaicTextAppliedOperation[],
): Record<string, boolean> {
	const activeEdits: Record<string, boolean> = {}
	for (const action of actions) {
		if (action.operation.type === `edit`) activeEdits[action.id] = true
		else {
			const active = action.operation.mode === `redo`
			for (const target of action.operation.targetOperationIds) {
				activeEdits[target] = active
			}
		}
	}
	return activeEdits
}

function operationForAction(
	state: MosaicTextState,
	action: MosaicTextAppliedOperation,
): MosaicTextOperation {
	if (action.operation.type === `history`) return action.operation
	return {
		deleted: action.operation.deleted,
		inserted: action.operation.insertedRunIds.map((id) => {
			const run = state.runs[id]
			return {
				after: run.after,
				before: run.before,
				id: run.id,
				text: indexRun(run).text,
			}
		}),
		type: `edit`,
	}
}

function canonicalTextOperation(
	operation: MosaicTextOperation,
): MosaicTextOperation {
	if (operation.type === `history`) {
		return {
			mode: operation.mode,
			targetOperationIds: [...operation.targetOperationIds],
			type: `history`,
		}
	}
	return {
		deleted: normalizeDeletionIntervals(operation.deleted),
		inserted: operation.inserted.map(({ after, before, id, text }) => ({
			after:
				after === null ? null : { offset: after.offset, runId: after.runId },
			before:
				before === null ? null : { offset: before.offset, runId: before.runId },
			id,
			text,
		})),
		type: `edit`,
	}
}

function applyTextOperation(
	state: MosaicTextState,
	operation: MosaicTextOperation,
	context: MosaicReduceContext,
): MosaicTextState {
	const duplicate = state.actions.find(({ id }) => id === context.id)
	const gestureId = context.group ?? context.id
	if (duplicate !== undefined) {
		if (
			duplicate.actor !== context.actor ||
			duplicate.gestureId !== gestureId ||
			duplicate.session !== context.session ||
			!sameTargets(duplicate.dependencies, context.dependencies) ||
			JSON.stringify(operationForAction(state, duplicate)) !==
				JSON.stringify(canonicalTextOperation(operation)) ||
			(duplicate.revision !== null &&
				context.revision !== null &&
				duplicate.revision !== context.revision)
		) {
			throw new Error(`Mosaic operation id collision: ${context.id}`)
		}
		if (duplicate.revision === null && context.revision !== null) {
			const actions = state.actions
				.map((action) =>
					action.id === duplicate.id
						? { ...action, revision: context.revision }
						: action,
				)
				.sort(compareActions)
			return {
				actions,
				activeEdits: recomputeActiveEdits(actions),
				runs: state.runs,
			}
		}
		return state
	}
	const runs = { ...state.runs }
	let checkpointOperation: MosaicTextCheckpointOperation
	if (operation.type === `edit`) {
		for (const inserted of operation.inserted) {
			runs[inserted.id] = createRun(inserted, context.id)
		}
		checkpointOperation = {
			deleted: operation.deleted,
			insertedRunIds: operation.inserted.map(({ id }) => id),
			type: `edit`,
		}
	} else {
		checkpointOperation = operation
	}
	const actions = [
		...state.actions,
		{
			actor: context.actor,
			dependencies: [...context.dependencies],
			gestureId,
			id: context.id,
			operation: checkpointOperation,
			revision: context.revision,
			session: context.session,
		},
	].sort(compareActions)
	return {
		actions,
		activeEdits: recomputeActiveEdits(actions),
		runs,
	}
}

function boundaryKey(boundary: MosaicTextBoundary): string {
	return JSON.stringify([boundary.runId, boundary.offset])
}

function boundaryIsWithinRun(
	state: MosaicTextState,
	boundary: MosaicTextBoundary | null,
	rootRunId: string,
): boolean {
	let cursor = boundary?.runId ?? null
	const seen = new Set<string>()
	while (cursor !== null && !seen.has(cursor)) {
		if (cursor === rootRunId) return true
		seen.add(cursor)
		cursor = state.runs[cursor]?.after?.runId ?? null
	}
	return false
}

function boundaryDescendsFrom(
	state: MosaicTextState,
	candidate: MosaicTextBoundary,
	ancestor: MosaicTextBoundary,
): boolean {
	let cursor: MosaicTextRun | undefined = state.runs[candidate.runId]
	const seen = new Set<string>()
	while (cursor !== undefined && !seen.has(cursor.id)) {
		seen.add(cursor.id)
		if (sameBoundary(cursor.after, ancestor)) return true
		cursor = cursor.after === null ? undefined : state.runs[cursor.after.runId]
	}
	return false
}

function childRuns(state: MosaicTextState): {
	readonly byBoundary: ReadonlyMap<string, readonly MosaicTextRun[]>
	readonly offsetsByRun: ReadonlyMap<string, ReadonlySet<number>>
	readonly roots: readonly MosaicTextRun[]
} {
	const byBoundary = new Map<string, MosaicTextRun[]>()
	const offsetsByRun = new Map<string, Set<number>>()
	const roots: MosaicTextRun[] = []
	for (const run of Object.values(state.runs)) {
		const siblings =
			run.after === null ? roots : (byBoundary.get(boundaryKey(run.after)) ?? [])
		siblings.push(run)
		if (run.after !== null) {
			byBoundary.set(boundaryKey(run.after), siblings)
			const offsets = offsetsByRun.get(run.after.runId) ?? new Set<number>()
			offsets.add(run.after.offset)
			offsetsByRun.set(run.after.runId, offsets)
		}
	}
	const sort = (siblings: MosaicTextRun[]): void => {
		// Normalize the input order first. Even a malformed/non-transitive retained
		// interval relation must not make delivery order observable.
		siblings.sort((left, right) => compareMosaicIds(left.id, right.id))
		siblings.sort((left, right) => {
			const leftBeforeRight = boundaryIsWithinRun(state, left.before, right.id)
			const rightBeforeLeft = boundaryIsWithinRun(state, right.before, left.id)
			if (leftBeforeRight !== rightBeforeLeft) return leftBeforeRight ? -1 : 1
			return compareMosaicIds(left.id, right.id)
		})
	}
	sort(roots)
	for (const siblings of byBoundary.values()) sort(siblings)
	return { byBoundary, offsetsByRun, roots }
}

function activeDeletionIntervals(
	state: MosaicTextState,
): ReadonlyMap<string, readonly MosaicTextDeletionInterval[]> {
	const byRun = new Map<string, MosaicTextDeletionInterval[]>()
	for (const action of state.actions) {
		if (
			action.operation.type !== `edit` ||
			state.activeEdits[action.id] !== true
		) {
			continue
		}
		for (const interval of action.operation.deleted) {
			const intervals = byRun.get(interval.runId) ?? []
			intervals.push(interval)
			byRun.set(interval.runId, intervals)
		}
	}
	for (const [runId, intervals] of byRun) {
		intervals.sort(
			(left, right) => left.start - right.start || left.end - right.end,
		)
		const merged: MosaicTextDeletionInterval[] = []
		for (const interval of intervals) {
			const previous = merged.at(-1)
			if (previous !== undefined && interval.start <= previous.end) {
				merged[merged.length - 1] = {
					end: Math.max(previous.end, interval.end),
					runId,
					start: previous.start,
				}
			} else merged.push(interval)
		}
		byRun.set(runId, merged)
	}
	return byRun
}

type TraversalTask =
	| {
			readonly end: number
			readonly kind: `slice`
			readonly run: MosaicTextRun
			readonly start: number
	  }
	| { readonly kind: `run`; readonly run: MosaicTextRun }
	| {
			readonly kind: `boundary`
			readonly offset: number
			readonly phase: `left` | `right`
			readonly run: MosaicTextRun
	  }

type TraverseOptions = {
	readonly boundaryTargets?: ReadonlyMap<string, ReadonlySet<number>>
	/** Skip UTF-16 materialization when a caller only needs logical order. */
	readonly measureUtf16?: boolean
	readonly mode: `structural` | `visible`
	readonly onBoundary?: (
		run: MosaicTextRun,
		offset: number,
		phase: `left` | `right`,
		utf16Offset: number,
	) => void
	readonly onSlice?: (
		run: MosaicTextRun,
		start: number,
		end: number,
		text: string,
		utf16Offset: number,
	) => void
	readonly onStructuralSlice?: (
		run: MosaicTextRun,
		start: number,
		end: number,
	) => void
}

function traverseText(state: MosaicTextState, options: TraverseOptions): number {
	const children = childRuns(state)
	const deletions =
		options.mode === `visible` ? activeDeletionIntervals(state) : new Map()
	const stack: TraversalTask[] = []
	for (let index = children.roots.length - 1; index >= 0; index--) {
		stack.push({ kind: `run`, run: children.roots[index] })
	}
	let utf16Offset = 0
	while (stack.length > 0) {
		const task = stack.pop()!
		if (task.kind === `run`) {
			const eventOffsets = new Set<number>([0, task.run.graphemes])
			const targets = options.boundaryTargets?.get(task.run.id)
			if (targets !== undefined) {
				for (const offset of targets) eventOffsets.add(offset)
			}
			const childOffsets = children.offsetsByRun.get(task.run.id)
			if (childOffsets !== undefined) {
				for (const offset of childOffsets) eventOffsets.add(offset)
			}
			const orderedOffsets = [...eventOffsets].sort(
				(left, right) => left - right,
			)
			const expanded: TraversalTask[] = []
			let cursor = 0
			for (const offset of orderedOffsets) {
				if (cursor < offset) {
					expanded.push({
						end: offset,
						kind: `slice`,
						run: task.run,
						start: cursor,
					})
				}
				expanded.push({
					kind: `boundary`,
					offset,
					phase: `left`,
					run: task.run,
				})
				const descendants =
					children.byBoundary.get(boundaryKey({ offset, runId: task.run.id })) ??
					[]
				for (const descendant of descendants) {
					expanded.push({ kind: `run`, run: descendant })
				}
				expanded.push({
					kind: `boundary`,
					offset,
					phase: `right`,
					run: task.run,
				})
				cursor = offset
			}
			for (let index = expanded.length - 1; index >= 0; index--) {
				stack.push(expanded[index])
			}
			continue
		}
		if (task.kind === `boundary`) {
			options.onBoundary?.(task.run, task.offset, task.phase, utf16Offset)
			continue
		}
		if (
			options.mode === `structural` ||
			state.activeEdits[task.run.createdBy] === true
		) {
			let cursor = task.start
			const intervals = deletions.get(task.run.id) ?? []
			for (const interval of intervals) {
				if (interval.end <= cursor || interval.start >= task.end) continue
				const visibleEnd = Math.min(interval.start, task.end)
				if (cursor < visibleEnd) {
					options.onStructuralSlice?.(task.run, cursor, visibleEnd)
					if (options.measureUtf16 !== false) {
						const text = sliceRun(task.run, cursor, visibleEnd)
						options.onSlice?.(task.run, cursor, visibleEnd, text, utf16Offset)
						utf16Offset += text.length
					}
				}
				cursor = Math.max(cursor, interval.end)
				if (cursor >= task.end) break
			}
			if (cursor < task.end) {
				options.onStructuralSlice?.(task.run, cursor, task.end)
				if (options.measureUtf16 !== false) {
					const text = sliceRun(task.run, cursor, task.end)
					options.onSlice?.(task.run, cursor, task.end, text, utf16Offset)
					utf16Offset += text.length
				}
			}
		}
	}
	return utf16Offset
}

function visibleRunsFromState(state: MosaicTextState): MosaicTextVisibleRun[] {
	const visible: MosaicTextVisibleRun[] = []
	traverseText(state, {
		mode: `visible`,
		onSlice: (run, start, end, text) => {
			const previous = visible.at(-1)
			if (previous?.id === run.id && previous.end === start) {
				visible[visible.length - 1] = {
					...previous,
					end,
					text: previous.text + text,
				}
			} else {
				visible.push({ createdBy: run.createdBy, end, id: run.id, start, text })
			}
		},
	})
	return visible
}

function materializeState(state: MosaicTextState): string {
	return visibleRunsFromState(state)
		.map(({ text }) => text)
		.join(``)
}

function textUnits(state: MosaicTextState): TextUnitArrays {
	const units: TextUnitArrays = { offsets: [], runIds: [], values: [] }
	for (const run of visibleRunsFromState(state)) {
		const values = splitMosaicText(run.text)
		for (const [index, value] of values.entries()) {
			units.runIds.push(run.id)
			units.offsets.push(run.start + index)
			units.values.push(value)
		}
	}
	return units
}

function normalizeDeletionIntervals(
	intervals: readonly MosaicTextDeletionInterval[],
): MosaicTextDeletionInterval[] {
	const ordered = [...intervals].sort(
		(left, right) =>
			compareMosaicIds(left.runId, right.runId) ||
			left.start - right.start ||
			left.end - right.end,
	)
	const normalized: MosaicTextDeletionInterval[] = []
	for (const interval of ordered) {
		const previous = normalized.at(-1)
		if (
			previous !== undefined &&
			previous.runId === interval.runId &&
			interval.start <= previous.end
		) {
			normalized[normalized.length - 1] = {
				end: Math.max(previous.end, interval.end),
				runId: previous.runId,
				start: previous.start,
			}
		} else normalized.push(interval)
	}
	return normalized
}

function chunkGraphemes(
	values: readonly string[],
	limits: Pick<MosaicTextLimits, `maximumRunGraphemes` | `maximumRunUtf16Units`>,
): string[][] {
	const chunks: string[][] = []
	let current: string[] = []
	let currentUtf16Units = 0
	for (const grapheme of values) {
		if (
			grapheme.length > MAXIMUM_GRAPHEME_UTF16_UNITS ||
			grapheme.length > limits.maximumRunUtf16Units
		) {
			throw new RangeError(`Text contains an oversized Unicode grapheme`)
		}
		if (
			current.length === limits.maximumRunGraphemes ||
			currentUtf16Units + grapheme.length > limits.maximumRunUtf16Units
		) {
			chunks.push(current)
			current = []
			currentUtf16Units = 0
		}
		current.push(grapheme)
		currentUtf16Units += grapheme.length
	}
	if (current.length > 0) chunks.push(current)
	return chunks
}

function chunkMosaicText(
	text: string,
	limits: Pick<MosaicTextLimits, `maximumRunGraphemes` | `maximumRunUtf16Units`>,
): { readonly graphemes: number; readonly text: string }[] {
	const chunks: { graphemes: number; text: string }[] = []
	let chunkStart = 0
	let chunkEnd = 0
	let graphemes = 0
	const flush = (): void => {
		if (graphemes === 0) return
		chunks.push({ graphemes, text: text.slice(chunkStart, chunkEnd) })
		chunkStart = chunkEnd
		graphemes = 0
	}
	visitMosaicTextGraphemes(text, (start, end) => {
		if (end - start > MAXIMUM_GRAPHEME_UTF16_UNITS) {
			throw new RangeError(`Text contains an oversized Unicode grapheme`)
		}
		if (end - start > limits.maximumRunUtf16Units) {
			throw new RangeError(`Text contains a grapheme larger than a run`)
		}
		if (
			graphemes > 0 &&
			(graphemes === limits.maximumRunGraphemes ||
				end - chunkStart > limits.maximumRunUtf16Units)
		) {
			flush()
			chunkStart = start
		}
		chunkEnd = end
		graphemes++
	})
	flush()
	return chunks
}

function diffText(
	state: MosaicTextState,
	nextText: string,
	context: MosaicPrepareContext,
	limits: MosaicTextLimits,
): MosaicTextEditOperation | null {
	const previous = textUnits(state)
	const next = splitMosaicText(nextText)
	let prefix = 0
	while (
		prefix < previous.values.length &&
		prefix < next.length &&
		previous.values[prefix] === next[prefix]
	) {
		prefix++
	}
	let suffix = 0
	while (
		suffix < previous.values.length - prefix &&
		suffix < next.length - prefix &&
		previous.values[previous.values.length - suffix - 1] ===
			next[next.length - suffix - 1]
	) {
		suffix++
	}
	const deleted: MosaicTextDeletionInterval[] = []
	for (let index = prefix; index < previous.values.length - suffix; index++) {
		const interval = {
			end: previous.offsets[index] + 1,
			runId: previous.runIds[index],
			start: previous.offsets[index],
		}
		const prior = deleted.at(-1)
		if (prior?.runId === interval.runId && prior.end === interval.start) {
			deleted[deleted.length - 1] = { ...prior, end: interval.end }
		} else deleted.push(interval)
	}
	if (deleted.length > limits.maximumDeletionIntervalsPerOperation) {
		throw new RangeError(
			`Text edit exceeds maximumDeletionIntervalsPerOperation`,
		)
	}
	const insertedValues = next.slice(prefix, next.length - suffix)
	const insertedChunks = chunkGraphemes(insertedValues, limits)
	if (insertedChunks.length > limits.maximumRunsPerOperation) {
		throw new RangeError(`Text edit exceeds maximumRunsPerOperation`)
	}
	if (deleted.length === 0 && insertedValues.length === 0) return null
	const after: MosaicTextBoundary | null =
		prefix === 0
			? null
			: {
					offset: previous.offsets[prefix - 1] + 1,
					runId: previous.runIds[prefix - 1],
				}
	const beforeIndex = previous.values.length - suffix
	const before: MosaicTextBoundary | null =
		beforeIndex === previous.values.length
			? null
			: {
					offset: previous.offsets[beforeIndex],
					runId: previous.runIds[beforeIndex],
				}
	const inserted: MosaicTextInsertedRun[] = []
	let insertionAfter = after
	for (const [index, values] of insertedChunks.entries()) {
		const run: MosaicTextInsertedRun = {
			after: insertionAfter,
			before,
			id: `${context.id}:run:${index.toString().padStart(6, `0`)}`,
			text: values.join(``),
		}
		inserted.push(run)
		insertionAfter = { offset: values.length, runId: run.id }
	}
	return { deleted, inserted, type: `edit` }
}

function selectionTargets(
	selection: MosaicTextSelection,
): ReadonlyMap<string, ReadonlySet<number>> {
	const targets = new Map<string, Set<number>>()
	for (const position of [selection.anchor, selection.head]) {
		if (position.runId === null) continue
		const offsets = targets.get(position.runId) ?? new Set<number>()
		offsets.add(position.offset)
		targets.set(position.runId, offsets)
	}
	return targets
}

function sameRelativePosition(
	left: MosaicTextRelativePosition,
	right: MosaicTextRelativePosition,
): boolean {
	return (
		left.affinity === right.affinity &&
		left.offset === right.offset &&
		left.runId === right.runId
	)
}

function boundaryEventMatches(
	position: MosaicTextRelativePosition,
	run: MosaicTextRun,
	offset: number,
	phase: `left` | `right`,
): boolean {
	return (
		position.runId === run.id &&
		position.offset === offset &&
		position.affinity === phase
	)
}

function orderedSelection(
	state: MosaicTextState,
	selection: MosaicTextSelection,
): readonly [MosaicTextRelativePosition, MosaicTextRelativePosition] {
	if (sameRelativePosition(selection.anchor, selection.head)) {
		return [selection.anchor, selection.head]
	}
	const order = new Map<MosaicTextRelativePosition, number>()
	let ordinal = 0
	for (const position of [selection.anchor, selection.head]) {
		if (position.runId === null) {
			order.set(position, position.affinity === `right` ? -1 : MAXIMUM_LIMIT)
		}
	}
	traverseText(state, {
		boundaryTargets: selectionTargets(selection),
		measureUtf16: false,
		mode: `visible`,
		onBoundary: (run, offset, phase) => {
			for (const position of [selection.anchor, selection.head]) {
				if (boundaryEventMatches(position, run, offset, phase)) {
					order.set(position, ordinal)
				}
			}
			ordinal++
		},
	})
	const anchor = order.get(selection.anchor)
	const head = order.get(selection.head)
	if (anchor === undefined || head === undefined) {
		throw new RangeError(`Mosaic text selection contains an unknown position`)
	}
	return anchor <= head
		? [selection.anchor, selection.head]
		: [selection.head, selection.anchor]
}

function replaceSelection(
	state: MosaicTextState,
	selection: MosaicTextSelection,
	text: string,
	context: MosaicPrepareContext,
	limits: MosaicTextLimits,
): MosaicTextEditOperation | null {
	const [start, end] = orderedSelection(state, selection)
	const deleted: MosaicTextDeletionInterval[] = []
	if (!sameRelativePosition(start, end)) {
		let selecting = start.runId === null && start.affinity === `right`
		traverseText(state, {
			boundaryTargets: selectionTargets({ anchor: start, head: end }),
			measureUtf16: false,
			mode: `visible`,
			onBoundary: (run, offset, phase) => {
				if (boundaryEventMatches(end, run, offset, phase)) selecting = false
				if (boundaryEventMatches(start, run, offset, phase)) selecting = true
			},
			onStructuralSlice: (run, sliceStart, sliceEnd) => {
				if (!selecting) return
				deleted.push({ end: sliceEnd, runId: run.id, start: sliceStart })
			},
		})
	}
	const normalized = normalizeDeletionIntervals(deleted)
	if (normalized.length > limits.maximumDeletionIntervalsPerOperation) {
		throw new RangeError(
			`Text edit exceeds maximumDeletionIntervalsPerOperation`,
		)
	}
	const chunks = chunkMosaicText(text, limits)
	if (chunks.length > limits.maximumRunsPerOperation) {
		throw new RangeError(`Text edit exceeds maximumRunsPerOperation`)
	}
	const afterBoundary: MosaicTextBoundary | null =
		start.runId === null ? null : { offset: start.offset, runId: start.runId }
	const beforeBoundary: MosaicTextBoundary | null =
		end.runId === null ? null : { offset: end.offset, runId: end.runId }
	const inserted: MosaicTextInsertedRun[] = []
	let after = afterBoundary
	for (const [index, chunk] of chunks.entries()) {
		const run: MosaicTextInsertedRun = {
			after,
			before: beforeBoundary,
			id: `${context.id}:run:${index.toString().padStart(6, `0`)}`,
			text: chunk.text,
		}
		inserted.push(run)
		after = { offset: chunk.graphemes, runId: run.id }
	}
	if (normalized.length === 0 && inserted.length === 0) return null
	return { deleted: normalized, inserted, type: `edit` }
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

function historyFromState(
	state: MosaicTextState,
	actor: string,
): MosaicTextHistory {
	const undo: MosaicTextHistoryGroup[] = []
	const redo: MosaicTextHistoryGroup[] = []
	for (const action of state.actions) {
		if (action.actor !== actor) continue
		if (action.operation.type === `edit`) {
			const previous = undo.at(-1)
			if (previous?.gestureId === action.gestureId) {
				;(previous.targetOperationIds as string[]).push(action.id)
			} else {
				undo.push({
					gestureId: action.gestureId,
					targetOperationIds: [action.id],
				})
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
		if (index !== -1) to.push(from.splice(index, 1)[0])
	}
	return { redo, undo }
}

function prepareText(
	state: MosaicTextState,
	intent: MosaicTextIntent,
	context: MosaicPrepareContext,
	limits: MosaicTextLimits,
): MosaicTextOperation | null {
	if (intent.type === `replace-text`) {
		return diffText(state, intent.text, context, limits)
	}
	if (intent.type === `replace-selection`) {
		return replaceSelection(
			state,
			intent.selection,
			intent.text,
			context,
			limits,
		)
	}
	const target = historyFromState(state, context.actor)[intent.type].at(-1)
	return target === undefined
		? null
		: {
				mode: intent.type,
				targetOperationIds: target.targetOperationIds,
				type: `history`,
			}
}

function missingDependencies(
	state: MosaicTextState,
	context: MosaicReduceContext,
): string[] {
	const accepted = new Set(state.actions.map(({ id }) => id))
	return context.dependencies.filter((dependency) => !accepted.has(dependency))
}

function validateBoundary(
	state: MosaicTextState,
	value: unknown,
	missing: readonly string[],
):
	| { readonly boundary: MosaicTextBoundary | null; readonly status: `valid` }
	| {
			readonly decision: MosaicModelDecision<MosaicTextOperation>
			readonly status: `invalid`
	  } {
	const boundary = parseBoundary(value)
	if (boundary === undefined) {
		return {
			decision: { reason: `Malformed run boundary.`, status: `reject` },
			status: `invalid`,
		}
	}
	if (boundary === null) return { boundary, status: `valid` }
	const run = state.runs[boundary.runId]
	if (run === undefined) {
		return {
			decision:
				missing.length === 0
					? { reason: `Unknown run boundary.`, status: `reject` }
					: { dependencies: missing, status: `defer` },
			status: `invalid`,
		}
	}
	if (boundary.offset > run.graphemes) {
		return {
			decision: { reason: `Run boundary is out of range.`, status: `reject` },
			status: `invalid`,
		}
	}
	return { boundary, status: `valid` }
}

function structuralBoundaryOffset(
	state: MosaicTextState,
	boundary: MosaicTextBoundary,
): number | null {
	let result: number | null = null
	traverseText(state, {
		boundaryTargets: new Map([[boundary.runId, new Set([boundary.offset])]]),
		mode: `structural`,
		onBoundary: (run, offset, phase, utf16Offset) => {
			if (
				result === null &&
				phase === `left` &&
				run.id === boundary.runId &&
				offset === boundary.offset
			) {
				result = utf16Offset
			}
		},
	})
	return result
}

function validateTextOperation(
	state: MosaicTextState,
	value: unknown,
	context: MosaicReduceContext,
	limits: MosaicTextLimits,
): MosaicModelDecision<MosaicTextOperation> {
	if (!isRecord(value)) {
		return { reason: `Operation must be an object.`, status: `reject` }
	}
	if (value[`type`] === `edit`) {
		if (
			!Array.isArray(value[`inserted`]) ||
			!Array.isArray(value[`deleted`]) ||
			value[`inserted`].length > limits.maximumRunsPerOperation ||
			value[`deleted`].length > limits.maximumDeletionIntervalsPerOperation
		) {
			return { reason: `Malformed text edit.`, status: `reject` }
		}
		const missing = missingDependencies(state, context)
		const known = new Set(Object.keys(state.runs))
		const inserted: MosaicTextInsertedRun[] = []
		for (const [index, candidate] of value[`inserted`].entries()) {
			if (!isRecord(candidate)) {
				return { reason: `Malformed inserted run.`, status: `reject` }
			}
			const id = candidate[`id`]
			const text = candidate[`text`]
			if (
				!isId(id) ||
				id !== `${context.id}:run:${index.toString().padStart(6, `0`)}` ||
				typeof text !== `string` ||
				text.length === 0 ||
				text.length > limits.maximumRunUtf16Units ||
				known.has(id)
			) {
				return { reason: `Invalid inserted run.`, status: `reject` }
			}
			let graphemeCount = 0
			let oversized = false
			visitMosaicTextGraphemes(text, (start, end) => {
				graphemeCount++
				if (end - start > MAXIMUM_GRAPHEME_UTF16_UNITS) oversized = true
			})
			if (
				graphemeCount === 0 ||
				graphemeCount > limits.maximumRunGraphemes ||
				oversized
			) {
				return {
					reason: `Inserted run exceeds its grapheme bound.`,
					status: `reject`,
				}
			}
			const after = validateBoundary(state, candidate[`after`], missing)
			const before = validateBoundary(state, candidate[`before`], missing)
			let parsedAfter: MosaicTextBoundary | null
			if (index > 0) {
				const previous = inserted[index - 1]
				const chainedAfter = parseBoundary(candidate[`after`])
				if (
					chainedAfter === undefined ||
					!sameBoundary(chainedAfter, {
						offset: countMosaicTextGraphemes(previous.text),
						runId: previous.id,
					})
				) {
					return { reason: `Invalid inserted run chain.`, status: `reject` }
				}
				parsedAfter = chainedAfter
			} else {
				if (after.status === `invalid`) return after.decision
				parsedAfter = after.boundary
			}
			if (before.status === `invalid`) return before.decision
			inserted.push({
				after: parsedAfter,
				before: before.boundary,
				id,
				text,
			})
			known.add(id)
		}
		if (inserted.length > 0) {
			const first = inserted[0]
			if (first.after !== null && first.before !== null) {
				const left = structuralBoundaryOffset(state, first.after)
				const right = structuralBoundaryOffset(state, first.before)
				if (
					left !== null &&
					right !== null &&
					left > right &&
					!boundaryDescendsFrom(state, first.after, first.before) &&
					!boundaryDescendsFrom(state, first.before, first.after)
				) {
					return {
						reason: `The insertion interval is inverted.`,
						status: `reject`,
					}
				}
			}
			const retainedBefore = first.before
			if (
				!inserted.every(({ before }) => sameBoundary(before, retainedBefore))
			) {
				return { reason: `Invalid inserted run chain.`, status: `reject` }
			}
		}
		const deleted: MosaicTextDeletionInterval[] = []
		for (const candidate of value[`deleted`]) {
			if (
				!isRecord(candidate) ||
				!isId(candidate[`runId`]) ||
				!isBoundedInteger(candidate[`start`]) ||
				!isBoundedInteger(candidate[`end`])
			) {
				return { reason: `Malformed deletion interval.`, status: `reject` }
			}
			const interval: MosaicTextDeletionInterval = {
				end: candidate[`end`] as number,
				runId: candidate[`runId`],
				start: candidate[`start`] as number,
			}
			const run = state.runs[interval.runId]
			if (run === undefined) {
				return missing.length === 0
					? { reason: `Unknown deletion run.`, status: `reject` }
					: { dependencies: missing, status: `defer` }
			}
			if (interval.start >= interval.end || interval.end > run.graphemes) {
				return { reason: `Deletion interval is out of range.`, status: `reject` }
			}
			deleted.push(interval)
		}
		return {
			operation: {
				deleted: normalizeDeletionIntervals(deleted),
				inserted,
				type: `edit`,
			},
			status: `accept`,
		}
	}
	if (value[`type`] === `history`) {
		if (
			(value[`mode`] !== `undo` && value[`mode`] !== `redo`) ||
			!Array.isArray(value[`targetOperationIds`]) ||
			value[`targetOperationIds`].length === 0 ||
			value[`targetOperationIds`].length > limits.maximumHistoryTargets ||
			!value[`targetOperationIds`].every(isId)
		) {
			return { reason: `Malformed history operation.`, status: `reject` }
		}
		const mode = value[`mode`]
		const expected = historyFromState(state, context.actor)[mode].at(-1)
		if (
			expected === undefined ||
			!sameTargets(expected.targetOperationIds, value[`targetOperationIds`])
		) {
			return {
				code: `stale-history`,
				reason: `The actor history cursor is stale.`,
				recovery: `resnapshot`,
				status: `reject`,
			}
		}
		return {
			operation: {
				mode,
				targetOperationIds: [...value[`targetOperationIds`]],
				type: `history`,
			},
			status: `accept`,
		}
	}
	return { reason: `Unknown text operation type.`, status: `reject` }
}

function snapshotFromState(state: MosaicTextState): MosaicTextSnapshot {
	return {
		actions: structuredClone(state.actions),
		runs: structuredClone(
			Object.values(state.runs).sort((left, right) =>
				compareMosaicIds(left.id, right.id),
			),
		),
		version: 2,
	}
}

function validateCheckpointRun(
	value: unknown,
	limits: Pick<MosaicTextLimits, `maximumRunGraphemes` | `maximumRunUtf16Units`>,
): MosaicTextRun {
	if (
		!isRecord(value) ||
		!isId(value[`id`]) ||
		!isId(value[`createdBy`]) ||
		!isBoundedInteger(value[`graphemes`]) ||
		(value[`graphemes`] as number) < 1 ||
		!Array.isArray(value[`fragments`]) ||
		value[`fragments`].length === 0 ||
		value[`fragments`].length > limits.maximumRunGraphemes
	) {
		throw new Error(`Invalid Mosaic text checkpoint run`)
	}
	const after = parseBoundary(value[`after`])
	const before = parseBoundary(value[`before`])
	if (after === undefined || before === undefined) {
		throw new Error(`Invalid Mosaic text checkpoint run boundary`)
	}
	const fragments: MosaicTextRunFragment[] = []
	let offset = 0
	let utf16Units = 0
	for (const fragment of value[`fragments`]) {
		if (
			!isRecord(fragment) ||
			fragment[`start`] !== offset ||
			typeof fragment[`text`] !== `string` ||
			fragment[`text`].length === 0
		) {
			throw new Error(`Invalid Mosaic text checkpoint fragments`)
		}
		utf16Units += fragment[`text`].length
		if (utf16Units > limits.maximumRunUtf16Units) {
			throw new Error(`Invalid Mosaic text checkpoint run`)
		}
		const count = countMosaicTextGraphemes(fragment[`text`])
		if (count === 0 || offset + count > limits.maximumRunGraphemes) {
			throw new Error(`Invalid Mosaic text checkpoint fragments`)
		}
		fragments.push({ start: offset, text: fragment[`text`] })
		offset += count
	}
	const combined = fragments.map(({ text }) => text).join(``)
	let combinedGraphemes = 0
	let oversized = false
	visitMosaicTextGraphemes(combined, (start, end) => {
		combinedGraphemes++
		if (end - start > MAXIMUM_GRAPHEME_UTF16_UNITS) oversized = true
	})
	if (
		offset !== value[`graphemes`] ||
		combinedGraphemes !== offset ||
		oversized
	) {
		throw new Error(`Invalid Mosaic text checkpoint grapheme count`)
	}
	return {
		after,
		before,
		createdBy: value[`createdBy`],
		fragments,
		graphemes: offset,
		id: value[`id`],
	}
}

function hydrateMosaicText(
	snapshot: unknown,
	limits: MosaicTextLimits,
): MosaicTextState {
	if (
		!isRecord(snapshot) ||
		snapshot[`version`] !== 2 ||
		!Array.isArray(snapshot[`actions`]) ||
		!Array.isArray(snapshot[`runs`])
	) {
		throw new Error(`Invalid Mosaic text snapshot`)
	}
	const checkpointRuns = new Map<string, MosaicTextRun>()
	for (const candidate of snapshot[`runs`]) {
		const run = validateCheckpointRun(candidate, limits)
		if (
			checkpointRuns.has(run.id) ||
			run.graphemes > limits.maximumRunGraphemes ||
			indexRun(run).text.length > limits.maximumRunUtf16Units
		) {
			throw new Error(`Invalid Mosaic text checkpoint run`)
		}
		checkpointRuns.set(run.id, run)
	}
	let state = createEmptyState()
	const seenActions = new Set<string>()
	const usedRuns = new Set<string>()
	for (const candidate of snapshot[`actions`]) {
		if (!isRecord(candidate) || !isRecord(candidate[`operation`])) {
			throw new Error(`Invalid Mosaic text snapshot action`)
		}
		const { actor, dependencies, gestureId, id, operation, revision, session } =
			candidate
		if (
			!isId(actor) ||
			!Array.isArray(dependencies) ||
			!dependencies.every(isId) ||
			!isId(gestureId) ||
			!isId(id) ||
			!isId(session) ||
			(revision !== null && !isBoundedInteger(revision, Number.MAX_SAFE_INTEGER))
		) {
			throw new Error(`Invalid Mosaic text snapshot action`)
		}
		if (seenActions.has(id)) {
			throw new Error(`Invalid Mosaic text checkpoint duplicate action`)
		}
		if (
			dependencies.length > 10_000 ||
			new Set(dependencies).size !== dependencies.length ||
			dependencies.includes(id)
		) {
			throw new Error(`Invalid Mosaic text checkpoint dependencies`)
		}
		seenActions.add(id)
		let wireOperation: MosaicTextOperation
		if (operation[`type`] === `edit`) {
			if (
				!Array.isArray(operation[`insertedRunIds`]) ||
				!operation[`insertedRunIds`].every(isId) ||
				!Array.isArray(operation[`deleted`])
			) {
				throw new Error(`Invalid Mosaic text checkpoint edit`)
			}
			wireOperation = {
				deleted: operation[`deleted`] as MosaicTextDeletionInterval[],
				inserted: operation[`insertedRunIds`].map((runId) => {
					const run = checkpointRuns.get(runId)
					if (
						run === undefined ||
						run.createdBy !== id ||
						usedRuns.has(run.id)
					) {
						throw new Error(`Invalid Mosaic text checkpoint run ownership`)
					}
					usedRuns.add(run.id)
					return {
						after: run.after,
						before: run.before,
						id: run.id,
						text: indexRun(run).text,
					}
				}),
				type: `edit`,
			}
		} else {
			wireOperation = operation as MosaicTextHistoryOperation
		}
		const context: MosaicReduceContext = {
			actor,
			dependencies: [...dependencies],
			group: gestureId,
			id,
			revision: revision as number | null,
			session,
		}
		const trustedBaseline =
			actor === `system` &&
			session === `system` &&
			revision === 0 &&
			gestureId === id &&
			dependencies.length === 0 &&
			id.startsWith(`mosaic:text:baseline:`) &&
			wireOperation.type === `edit`
		if (trustedBaseline && wireOperation.type === `edit`) {
			for (const inserted of wireOperation.inserted) {
				for (const boundary of [inserted.after, inserted.before]) {
					if (boundary === null) continue
					const run = checkpointRuns.get(boundary.runId)
					if (run === undefined || boundary.offset > run.graphemes) {
						throw new Error(`Invalid Mosaic text baseline boundary`)
					}
				}
			}
			for (const interval of wireOperation.deleted) {
				const run = checkpointRuns.get(interval.runId)
				if (
					run === undefined ||
					!isBoundedInteger(interval.start) ||
					!isBoundedInteger(interval.end) ||
					interval.start >= interval.end ||
					interval.end > run.graphemes
				) {
					throw new Error(`Invalid Mosaic text baseline deletion`)
				}
			}
		}
		const decision = trustedBaseline
			? ({ operation: wireOperation, status: `accept` } as const)
			: validateTextOperation(state, wireOperation, context, limits)
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
	if (usedRuns.size !== checkpointRuns.size) {
		throw new Error(`Invalid Mosaic text checkpoint orphan run`)
	}
	// Restore the physical fragmentation after semantic replay validates it.
	const runs = { ...state.runs }
	for (const [id, checkpointRun] of checkpointRuns) runs[id] = checkpointRun
	return { ...state, runs }
}

function createSeededText(
	text: string,
	limits: MosaicTextLimits,
): MosaicTextState {
	let state = createEmptyState()
	const chunks = chunkMosaicText(text, limits)
	let after: MosaicTextBoundary | null = null
	let actionIndex = 0
	for (
		let operationStart = 0;
		operationStart < chunks.length;
		operationStart += limits.maximumRunsPerOperation
	) {
		const id = `mosaic:text:seed:${actionIndex.toString().padStart(6, `0`)}`
		const inserted: MosaicTextInsertedRun[] = []
		const operationEnd = Math.min(
			chunks.length,
			operationStart + limits.maximumRunsPerOperation,
		)
		for (
			let start = operationStart, runIndex = 0;
			start < operationEnd;
			start++, runIndex++
		) {
			const chunk = chunks[start]
			const run: MosaicTextInsertedRun = {
				after,
				before: null,
				id: `${id}:run:${runIndex.toString().padStart(6, `0`)}`,
				text: chunk.text,
			}
			inserted.push(run)
			after = { offset: chunk.graphemes, runId: run.id }
		}
		state = applyTextOperation(
			state,
			{ deleted: [], inserted, type: `edit` },
			{
				actor: `system`,
				dependencies: state.actions.at(-1)?.id ? [state.actions.at(-1)!.id] : [],
				group: id,
				id,
				// Seed actions precede the durable stream; revision zero is reserved for
				// that bootstrap regardless of how many bounded seed batches it needs.
				revision: 0,
				session: `system`,
			},
		)
		actionIndex++
	}
	return state
}

function stateForHelper(
	value: MosaicTextSnapshot | MosaicTextState,
): MosaicTextState {
	if (`version` in value) {
		return hydrateMosaicText(value, {
			maximumDeletionIntervalsPerOperation: MAXIMUM_LIMIT,
			maximumHistoryTargets: MAXIMUM_LIMIT,
			maximumRunGraphemes: MAXIMUM_LIMIT,
			maximumRunUtf16Units: MAXIMUM_UTF16_LIMIT,
			maximumRunsPerOperation: MAXIMUM_LIMIT,
		})
	}
	return value
}

export function visibleMosaicTextRuns(
	value: MosaicTextSnapshot | MosaicTextState,
): MosaicTextVisibleRun[] {
	return visibleRunsFromState(stateForHelper(value))
}

export function materializeMosaicText(
	value: MosaicTextSnapshot | MosaicTextState,
): string {
	return materializeState(stateForHelper(value))
}

export function deriveMosaicTextHistory(
	value: MosaicTextSnapshot | MosaicTextState,
	actor: string,
): MosaicTextHistory {
	return historyFromState(stateForHelper(value), actor)
}

/**
 * Fold operations older than the Domain history horizon into an equivalent
 * baseline while retaining stable runs and every still-addressable operation.
 */
export function compactMosaicTextHistory(
	value: MosaicTextSnapshot | MosaicTextState,
	retainedOperationIds: ReadonlySet<string>,
	throughRevision = 0,
): MosaicTextSnapshot {
	if (!isBoundedInteger(throughRevision, Number.MAX_SAFE_INTEGER)) {
		throw new Error(`Invalid Mosaic text history compaction revision`)
	}
	const state = stateForHelper(value)
	const retained = new Set(retainedOperationIds)
	const explicitlyRetainedHistory = new Set(
		state.actions
			.filter(
				(action) =>
					action.operation.type === `history` && retained.has(action.id),
			)
			.map(({ id }) => id),
	)
	for (const action of state.actions) {
		if (
			action.operation.type === `history` &&
			explicitlyRetainedHistory.has(action.id)
		) {
			for (const id of action.operation.targetOperationIds) retained.add(id)
		}
	}
	const retainedGestures = new Set(
		state.actions
			.filter(
				(action) => action.operation.type === `edit` && retained.has(action.id),
			)
			.map(({ gestureId }) => gestureId),
	)
	for (const action of state.actions) {
		if (
			action.operation.type === `edit` &&
			retainedGestures.has(action.gestureId)
		) {
			retained.add(action.id)
		}
	}
	for (const gestureId of retainedGestures) {
		const targetIds = state.actions
			.filter(
				(action) =>
					action.operation.type === `edit` && action.gestureId === gestureId,
			)
			.map(({ id }) => id)
		const histories = state.actions.filter(
			(action) =>
				action.operation.type === `history` &&
				sameTargets(action.operation.targetOperationIds, targetIds),
		)
		if (histories.some(({ id }) => explicitlyRetainedHistory.has(id))) {
			// A durable reference to a compensation retains the complete toggle chain;
			// otherwise replaying that protected operation could change final state.
			for (const action of histories) retained.add(action.id)
		} else if (targetIds.some((id) => state.activeEdits[id] !== true)) {
			const finalUndo = [...histories]
				.reverse()
				.find(
					(action) =>
						action.operation.type === `history` &&
						action.operation.mode === `undo`,
				)
			if (finalUndo !== undefined) retained.add(finalUndo.id)
		}
	}

	const kept = state.actions.filter(({ id }) => retained.has(id))
	const removed = state.actions.filter(({ id }) => !retained.has(id))
	const retiredEdits = removed.filter(
		(
			action,
		): action is MosaicTextAppliedOperation & {
			readonly operation: MosaicTextCheckpointEditOperation
		} => action.operation.type === `edit`,
	)
	if (removed.length === 0) return snapshotFromState(state)
	if (retiredEdits.length === 0) {
		const compacted = stateForHelper({
			actions: structuredClone(kept),
			runs: structuredClone(Object.values(state.runs)),
			version: 2,
		})
		if (materializeState(compacted) !== materializeState(state)) {
			throw new Error(`Mosaic text history compaction changed visible content`)
		}
		return snapshotFromState(compacted)
	}
	const retiredActiveRunIds = new Set<string>()
	const inactiveRunIds = new Set<string>()
	const activeDeletions: MosaicTextDeletionInterval[] = []
	const retiredEditIds = new Set(retiredEdits.map(({ id }) => id))
	for (const action of retiredEdits) {
		const active = state.activeEdits[action.id] === true
		for (const runId of action.operation.insertedRunIds) {
			;(active ? retiredActiveRunIds : inactiveRunIds).add(runId)
		}
		if (active) activeDeletions.push(...action.operation.deleted)
	}
	const baselineActions: MosaicTextAppliedOperation[] = []
	const requiredRunIds = new Set(visibleRunsFromState(state).map(({ id }) => id))
	for (const action of kept) {
		if (action.operation.type !== `edit`) continue
		for (const runId of action.operation.insertedRunIds)
			requiredRunIds.add(runId)
		for (const deletion of action.operation.deleted) {
			requiredRunIds.add(deletion.runId)
		}
	}
	const pendingRequired = [...requiredRunIds]
	let nextRequiredIndex = 0
	while (nextRequiredIndex < pendingRequired.length) {
		const runId = pendingRequired[nextRequiredIndex]
		nextRequiredIndex++
		const run = state.runs[runId]
		if (run === undefined) continue
		for (const boundary of [run.after, run.before]) {
			if (boundary === null || requiredRunIds.has(boundary.runId)) continue
			requiredRunIds.add(boundary.runId)
			pendingRequired.push(boundary.runId)
		}
	}
	const retainedInactiveRunIds = new Set(
		[...inactiveRunIds].filter((runId) => requiredRunIds.has(runId)),
	)
	const retainedActiveRunIds = new Set(
		[...retiredActiveRunIds].filter((runId) => requiredRunIds.has(runId)),
	)
	const retainedActiveDeletions = activeDeletions.filter(({ runId }) =>
		requiredRunIds.has(runId),
	)
	const baselineRuns = Object.fromEntries(
		Object.entries(state.runs).filter(
			([runId, run]) =>
				!retiredEditIds.has(run.createdBy) || requiredRunIds.has(runId),
		),
	)
	const usedActionIds = new Set(kept.map(({ id }) => id))
	const uniqueInternalId = (base: string): string => {
		let id = base
		let suffix = 0
		while (usedActionIds.has(id)) id = `${base}:${++suffix}`
		usedActionIds.add(id)
		return id
	}
	const createBaseline = (
		mode: `active` | `inactive`,
		runIds: ReadonlySet<string>,
		deletions: readonly MosaicTextDeletionInterval[],
	): string | null => {
		if (runIds.size === 0 && deletions.length === 0) return null
		const id = uniqueInternalId(
			`mosaic:text:baseline:${throughRevision}:${mode}`,
		)
		for (const runId of runIds) {
			const run = baselineRuns[runId]
			if (run === undefined) {
				throw new Error(`Mosaic text history compaction lost a retained run`)
			}
			baselineRuns[runId] = { ...run, createdBy: id }
		}
		baselineActions.push({
			actor: `system`,
			dependencies: [],
			gestureId: id,
			id,
			operation: {
				deleted: normalizeDeletionIntervals(deletions),
				insertedRunIds: [...runIds].sort(compareMosaicIds),
				type: `edit`,
			},
			revision: 0,
			session: `system`,
		})
		return id
	}
	createBaseline(`active`, retainedActiveRunIds, retainedActiveDeletions)
	const inactiveBaselineId = createBaseline(
		`inactive`,
		retainedInactiveRunIds,
		[],
	)
	if (inactiveBaselineId !== null) {
		const hiddenId = uniqueInternalId(`${inactiveBaselineId}:hidden`)
		baselineActions.push({
			actor: `system`,
			dependencies: [inactiveBaselineId],
			gestureId: hiddenId,
			id: hiddenId,
			operation: {
				mode: `undo`,
				targetOperationIds: [inactiveBaselineId],
				type: `history`,
			},
			revision: 0,
			session: `system`,
		})
	}
	for (const run of Object.values(baselineRuns)) {
		if (!retiredEditIds.has(run.createdBy)) continue
		throw new Error(`Mosaic text history compaction left an unowned run`)
	}
	const compacted: MosaicTextSnapshot = {
		actions: structuredClone([...baselineActions, ...kept]),
		runs: structuredClone(Object.values(baselineRuns)),
		version: 2,
	}
	// Hydration proves that folding retained the model's structural invariants.
	const checked = stateForHelper(compacted)
	if (materializeState(checked) !== materializeState(state)) {
		throw new Error(`Mosaic text history compaction changed visible content`)
	}
	return snapshotFromState(checked)
}

function positionAtStateOffset(
	state: MosaicTextState,
	utf16Offset: number,
): MosaicTextRelativePosition {
	const units = textUnits(state)
	let offset = 0
	for (const [index, value] of units.values.entries()) {
		const end = offset + value.length
		if (utf16Offset <= offset) {
			return {
				affinity: `right`,
				offset: units.offsets[index],
				runId: units.runIds[index],
			}
		}
		if (utf16Offset < end) {
			return {
				affinity: `left`,
				offset: units.offsets[index] + 1,
				runId: units.runIds[index],
			}
		}
		offset = end
	}
	if (units.values.length === 0) {
		return { affinity: `left`, offset: 0, runId: null }
	}
	return {
		affinity: `left`,
		offset: units.offsets.at(-1)! + 1,
		runId: units.runIds.at(-1)!,
	}
}

function resolveStatePosition(
	state: MosaicTextState,
	position: MosaicTextRelativePosition,
): number {
	if (position.runId === null) {
		return position.affinity === `right` ? 0 : materializeState(state).length
	}
	const run = state.runs[position.runId]
	if (
		run === undefined ||
		!Number.isSafeInteger(position.offset) ||
		position.offset < 0 ||
		position.offset > run.graphemes
	) {
		return 0
	}
	let resolved: number | null = null
	traverseText(state, {
		boundaryTargets: new Map([[position.runId, new Set([position.offset])]]),
		mode: `visible`,
		onBoundary: (candidate, offset, phase, utf16Offset) => {
			if (
				resolved === null &&
				candidate.id === position.runId &&
				offset === position.offset &&
				phase === position.affinity
			) {
				resolved = utf16Offset
			}
		},
	})
	return resolved ?? 0
}

export function positionAtMosaicTextOffset(
	value: MosaicTextSnapshot | MosaicTextState,
	utf16Offset: number,
): MosaicTextRelativePosition {
	return positionAtStateOffset(stateForHelper(value), utf16Offset)
}

export function resolveMosaicTextPosition(
	value: MosaicTextSnapshot | MosaicTextState,
	position: MosaicTextRelativePosition,
): number {
	return resolveStatePosition(stateForHelper(value), position)
}

function validateSegmentLimit(
	value: unknown,
	name: string,
	maximum = MAXIMUM_LIMIT,
): number {
	if (
		!Number.isSafeInteger(value) ||
		(value as number) < 1 ||
		(value as number) > maximum
	) {
		throw new RangeError(`${name} must be a positive bounded safe integer`)
	}
	return value as number
}

/**
 * Export a checkpoint into bounded physical payloads. This is storage
 * maintenance: actions and gesture history are copied without modification.
 */
export function exportMosaicTextSegments(
	snapshot: MosaicTextSnapshot,
	options: MosaicTextSegmentOptions,
): MosaicTextSegmentBundle {
	const maximumGraphemesPerSegment = validateSegmentLimit(
		options.maximumGraphemesPerSegment,
		`maximumGraphemesPerSegment`,
	)
	const maximumFragmentsPerSegment = validateSegmentLimit(
		options.maximumFragmentsPerSegment ?? 1_024,
		`maximumFragmentsPerSegment`,
	)
	const state = stateForHelper(snapshot)
	const segments: { fragments: MosaicTextSegmentFragment[]; index: number }[] =
		[]
	let current: { fragments: MosaicTextSegmentFragment[]; index: number } | null =
		null
	let currentGraphemes = 0
	let currentUtf16Units = 0
	const append = (fragment: MosaicTextSegmentFragment, count: number): void => {
		if (
			current === null ||
			current.fragments.length >= maximumFragmentsPerSegment ||
			currentGraphemes + count > maximumGraphemesPerSegment ||
			currentUtf16Units + fragment.text.length > MAXIMUM_UTF16_LIMIT
		) {
			current = { fragments: [], index: segments.length }
			segments.push(current)
			currentGraphemes = 0
			currentUtf16Units = 0
		}
		current.fragments.push(fragment)
		currentGraphemes += count
		currentUtf16Units += fragment.text.length
	}
	for (const run of Object.values(state.runs).sort((left, right) =>
		compareMosaicIds(left.id, right.id),
	)) {
		const values = splitMosaicText(indexRun(run).text)
		for (
			let start = 0;
			start < values.length;
			start += maximumGraphemesPerSegment
		) {
			const chunk = values.slice(start, start + maximumGraphemesPerSegment)
			append({ runId: run.id, start, text: chunk.join(``) }, chunk.length)
		}
	}
	return {
		manifest: {
			actions: structuredClone(state.actions),
			maximumFragmentsPerSegment,
			maximumGraphemesPerSegment,
			runs: Object.values(state.runs)
				.sort((left, right) => compareMosaicIds(left.id, right.id))
				.map(({ fragments: _, ...run }) => structuredClone(run)),
			segmentCount: segments.length,
			version: 1,
		},
		segments,
	}
}

/** Reassemble arbitrarily ordered, exactly duplicated physical payloads. */
export function importMosaicTextSegments(
	bundle: MosaicTextSegmentBundle,
): MosaicTextSnapshot {
	const raw: unknown = bundle
	if (
		!isRecord(raw) ||
		!isRecord(raw[`manifest`]) ||
		raw[`manifest`][`version`] !== 1 ||
		!Array.isArray(raw[`manifest`][`actions`]) ||
		!Array.isArray(raw[`manifest`][`runs`]) ||
		!Array.isArray(raw[`segments`])
	) {
		throw new Error(`Invalid Mosaic text segment bundle`)
	}
	const manifest = raw[`manifest`]
	const maximumGraphemesPerSegment = validateSegmentLimit(
		manifest[`maximumGraphemesPerSegment`],
		`maximumGraphemesPerSegment`,
	)
	const maximumFragmentsPerSegment = validateSegmentLimit(
		manifest[`maximumFragmentsPerSegment`],
		`maximumFragmentsPerSegment`,
	)
	if (!isBoundedInteger(manifest[`segmentCount`])) {
		throw new Error(`Invalid Mosaic text segment count`)
	}
	const segmentCount = manifest[`segmentCount`] as number
	const unique = new Map<number, MosaicTextPhysicalSegment>()
	for (const segment of raw[`segments`]) {
		if (
			!isRecord(segment) ||
			!isBoundedInteger(segment[`index`]) ||
			(segment[`index`] as number) >= segmentCount ||
			!Array.isArray(segment[`fragments`]) ||
			segment[`fragments`].length > maximumFragmentsPerSegment
		) {
			throw new Error(`Invalid Mosaic text physical segment`)
		}
		const index = segment[`index`] as number
		const prior = unique.get(index)
		if (prior !== undefined) {
			if (JSON.stringify(prior) !== JSON.stringify(segment)) {
				throw new Error(`Conflicting Mosaic text physical segment`)
			}
			continue
		}
		let graphemes = 0
		let utf16Units = 0
		const maximumUtf16Units = Math.min(
			MAXIMUM_UTF16_LIMIT,
			maximumGraphemesPerSegment * MAXIMUM_GRAPHEME_UTF16_UNITS,
		)
		for (const fragment of segment[`fragments`]) {
			if (
				!isRecord(fragment) ||
				!isId(fragment[`runId`]) ||
				!isBoundedInteger(fragment[`start`]) ||
				typeof fragment[`text`] !== `string` ||
				fragment[`text`].length === 0
			) {
				throw new Error(`Invalid Mosaic text segment fragment`)
			}
			utf16Units += fragment[`text`].length
			if (utf16Units > maximumUtf16Units) {
				throw new Error(`Mosaic text physical segment exceeds its bound`)
			}
			graphemes += splitMosaicText(fragment[`text`]).length
		}
		if (graphemes > maximumGraphemesPerSegment) {
			throw new Error(`Mosaic text physical segment exceeds its bound`)
		}
		unique.set(index, segment as unknown as MosaicTextPhysicalSegment)
	}
	if (unique.size !== segmentCount) {
		throw new Error(`Missing Mosaic text physical segment`)
	}
	const fragmentsByRun = new Map<string, MosaicTextRunFragment[]>()
	for (const segment of [...unique.values()].sort(
		(left, right) => left.index - right.index,
	)) {
		for (const fragment of segment.fragments) {
			const fragments = fragmentsByRun.get(fragment.runId) ?? []
			fragments.push({ start: fragment.start, text: fragment.text })
			fragmentsByRun.set(fragment.runId, fragments)
		}
	}
	const manifestRunIds = new Set(
		(manifest[`runs`] as Omit<MosaicTextRun, `fragments`>[]).map(({ id }) => id),
	)
	if ([...fragmentsByRun.keys()].some((runId) => !manifestRunIds.has(runId))) {
		throw new Error(`Unknown Mosaic text segment run`)
	}
	const runs: MosaicTextRun[] = (
		manifest[`runs`] as Omit<MosaicTextRun, `fragments`>[]
	).map((metadata) => {
		const fragments = fragmentsByRun.get(metadata.id) ?? []
		return { ...structuredClone(metadata), fragments }
	})
	const snapshot: MosaicTextSnapshot = {
		actions: structuredClone(
			manifest[`actions`] as MosaicTextAppliedOperation[],
		),
		runs,
		version: 2,
	}
	// General validation proves complete, contiguous fragments and valid history.
	stateForHelper(snapshot)
	return snapshot
}

/** Create the built-in convergent Unicode run-text transceiver class. */
export function mosaicText(
	options: MosaicTextOptions = {},
): MosaicTextConstructor {
	if (
		options.maximumGraphemes !== undefined &&
		options.maximumRunGraphemes !== undefined &&
		options.maximumGraphemes !== options.maximumRunGraphemes
	) {
		throw new Error(
			`maximumGraphemes and maximumRunGraphemes must agree when both are set`,
		)
	}
	const initialText = options.initialText ?? ``
	const limits: MosaicTextLimits = {
		maximumDeletionIntervalsPerOperation: validateSegmentLimit(
			options.maximumDeletionIntervalsPerOperation ?? 16_384,
			`maximumDeletionIntervalsPerOperation`,
		),
		maximumHistoryTargets: validateSegmentLimit(
			options.maximumHistoryTargets ?? 10_000,
			`maximumHistoryTargets`,
		),
		maximumRunGraphemes: validateSegmentLimit(
			options.maximumRunGraphemes ?? options.maximumGraphemes ?? 200_000,
			`maximumRunGraphemes`,
		),
		maximumRunUtf16Units: validateSegmentLimit(
			options.maximumRunUtf16Units ?? 4_000_000,
			`maximumRunUtf16Units`,
			MAXIMUM_UTF16_LIMIT,
		),
		maximumRunsPerOperation: validateSegmentLimit(
			options.maximumRunsPerOperation ?? 16,
			`maximumRunsPerOperation`,
		),
	}
	const configuration = { initialText, ...limits }

	class MosaicText implements MosaicTextTransceiver {
		public static readonly mosaic = {
			configuration,
			key: `text`,
			version: 2,
		} as const
		public static readonly timelinePolicy = `append-only` as const
		public static readonly domainHistory = {
			classify(operation: MosaicTextOperation) {
				return operation.type === `edit`
					? ({ kind: `change` } as const)
					: ({
							kind: `compensation`,
							mode: operation.mode,
							targetOperationIds: operation.targetOperationIds,
						} as const)
			},
			compact(
				value: MosaicTextSnapshot,
				context: {
					readonly retainedOperationIds: ReadonlySet<string>
					readonly throughRevision: number
				},
			) {
				return compactMosaicTextHistory(
					value,
					context.retainedOperationIds,
					context.throughRevision,
				)
			},
			compensate(context: {
				readonly mode: `redo` | `undo`
				readonly targets: readonly { readonly id: string }[]
			}): MosaicTextHistoryOperation {
				return {
					mode: context.mode,
					targetOperationIds: context.targets.map(({ id }) => id),
					type: `history`,
				}
			},
		} as const

		readonly #subject = new Subject<MosaicOperationSignal<MosaicTextOperation>>()
		#state = createSeededText(initialText, limits)

		public readonly READONLY_VIEW: MosaicTextView = this

		public historyFor(actor: string): MosaicTextHistory {
			return historyFromState(this.#state, actor)
		}

		public get length(): number {
			return this.text.length
		}

		public get runs(): readonly MosaicTextVisibleRun[] {
			return visibleRunsFromState(this.#state)
		}

		public get text(): string {
			return materializeState(this.#state)
		}

		public change(
			intent: MosaicTextIntent,
			context: MosaicPrepareContext,
		): MosaicOperationSignal<MosaicTextOperation> | null {
			const signal = this.prepare(intent, context)
			if (signal === null) return null
			this.do(signal)
			this.#subject.next(signal)
			return signal
		}

		public prepare(
			intent: MosaicTextIntent,
			context: MosaicPrepareContext,
		): MosaicOperationSignal<MosaicTextOperation> | null {
			const operation = prepareText(this.#state, intent, context, limits)
			return operation === null
				? null
				: {
						actor: context.actor,
						dependencies: context.dependencies,
						group: context.group,
						id: context.id,
						operation,
						revision: null,
						session: context.session,
					}
		}

		public preview(
			signal: MosaicOperationSignal<MosaicTextOperation>,
		): readonly MosaicTextVisibleRun[] {
			const context: MosaicReduceContext = {
				actor: signal.actor,
				dependencies: signal.dependencies,
				group: signal.group,
				id: signal.id,
				revision: signal.revision,
				session: signal.session,
			}
			const decision = validateTextOperation(
				this.#state,
				signal.operation,
				context,
				limits,
			)
			if (decision.status !== `accept`) {
				throw new Error(
					decision.status === `reject`
						? decision.reason
						: `Mosaic text preview is missing dependencies: ${decision.dependencies.join(
								`, `,
							)}`,
				)
			}
			return visibleRunsFromState(
				applyTextOperation(this.#state, decision.operation, context),
			)
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
			return positionAtStateOffset(this.#state, offset)
		}

		public resolvePosition(position: MosaicTextRelativePosition): number {
			return resolveStatePosition(this.#state, position)
		}

		public selectionFromOffsets(
			anchor: number,
			head: number,
		): MosaicTextSelection {
			return {
				anchor: positionAtStateOffset(this.#state, anchor),
				head: positionAtStateOffset(this.#state, head),
			}
		}

		public subscribe(
			key: string,
			fn: (signal: MosaicOperationSignal<MosaicTextOperation>) => void,
		): () => void {
			return this.#subject.subscribe(key, fn)
		}

		public toJSON(): MosaicTextSnapshot {
			return snapshotFromState(this.#state)
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
			return validateTextOperation(this.#state, operation, context, limits)
		}

		public static fromJSON(snapshot: MosaicTextSnapshot): MosaicText {
			const text = new MosaicText()
			text.#state = hydrateMosaicText(snapshot, limits)
			return text
		}
	}

	return MosaicText
}
