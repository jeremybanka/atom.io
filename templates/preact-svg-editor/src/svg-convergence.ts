import { z } from "zod"

export type SvgOrderRank = {
	readonly denominator: string
	readonly numerator: string
}

export type SvgOrderOperation = {
	readonly actor?: string | undefined
	readonly entryId: string
	readonly id: string
	readonly present: boolean
	readonly rank: SvgOrderRank
	readonly value: string
}

export type SvgHistoryOperation = {
	readonly actor: string
	readonly id: string
	readonly mode: `redo` | `undo`
	readonly targetOperationIds: readonly string[]
	readonly type: `history`
}

export type SvgOrderModelOperation = SvgHistoryOperation | SvgOrderOperation

export type SvgOrderState = {
	readonly history?: Readonly<Record<string, SvgHistoryOperation>> | undefined
	readonly operations: Readonly<Record<string, SvgOrderOperation>>
}

export type SvgOrderedEntry = {
	readonly entryId: string
	readonly rank: SvgOrderRank
	readonly value: string
}

export type SvgRegisterOperation<Value> = {
	readonly actor?: string | undefined
	readonly id: string
	readonly value: Value
}

export type SvgRegisterModelOperation<Value> =
	| SvgHistoryOperation
	| SvgRegisterOperation<Value>

export type SvgRegisterState<Value> = {
	readonly history?: Readonly<Record<string, SvgHistoryOperation>> | undefined
	readonly operations: Readonly<Record<string, SvgRegisterOperation<Value>>>
}

const integerStringSchema = z.string().regex(/^-?(?:0|[1-9]\d*)$/u)
const positiveIntegerStringSchema = z.string().regex(/^[1-9]\d*$/u)

export const svgOrderRankSchema: z.ZodType<SvgOrderRank> = z
	.object({
		denominator: positiveIntegerStringSchema,
		numerator: integerStringSchema,
	})
	.strict()

export const svgOrderOperationSchema: z.ZodType<SvgOrderOperation> = z
	.object({
		actor: z.string().min(1).optional(),
		entryId: z.string().min(1),
		id: z.string().min(1),
		present: z.boolean(),
		rank: svgOrderRankSchema,
		value: z.string().min(1),
	})
	.strict()

export const svgHistoryOperationSchema: z.ZodType<SvgHistoryOperation> = z
	.object({
		actor: z.string().min(1),
		id: z.string().min(1),
		mode: z.enum([`redo`, `undo`]),
		targetOperationIds: z.array(z.string().min(1)).min(1),
		type: z.literal(`history`),
	})
	.strict()
	.refine(
		({ targetOperationIds }) =>
			new Set(targetOperationIds).size === targetOperationIds.length,
		{ message: `SVG history targets must be unique` },
	)

export const svgOrderModelOperationSchema: z.ZodType<SvgOrderModelOperation> =
	z.union([svgHistoryOperationSchema, svgOrderOperationSchema])

export const svgOrderStateSchema: z.ZodType<SvgOrderState> = z
	.object({
		history: z.record(z.string(), svgHistoryOperationSchema).optional(),
		operations: z.record(z.string(), svgOrderOperationSchema),
	})
	.strict()
	.refine(
		({ operations }) =>
			Object.entries(operations).every(([id, operation]) => id === operation.id),
		{ message: `SVG order operation map keys must match operation IDs` },
	)
	.refine(
		({ history }) =>
			Object.entries(history ?? {}).every(
				([id, operation]) => id === operation.id,
			),
		{ message: `SVG order history map keys must match operation IDs` },
	)

export function svgRegisterOperationSchema<Value>(
	valueSchema: z.ZodType<Value>,
): z.ZodType<SvgRegisterOperation<Value>> {
	return z
		.object({
			actor: z.string().min(1).optional(),
			id: z.string().min(1),
			value: valueSchema,
		})
		.strict()
}

export function svgRegisterModelOperationSchema<Value>(
	valueSchema: z.ZodType<Value>,
): z.ZodType<SvgRegisterModelOperation<Value>> {
	return z.union([
		svgHistoryOperationSchema,
		svgRegisterOperationSchema(valueSchema),
	])
}

export function svgRegisterStateSchema<Value>(
	valueSchema: z.ZodType<Value>,
): z.ZodType<SvgRegisterState<Value>> {
	return z
		.object({
			history: z.record(z.string(), svgHistoryOperationSchema).optional(),
			operations: z.record(z.string(), svgRegisterOperationSchema(valueSchema)),
		})
		.strict()
		.refine(
			({ operations }) =>
				Object.entries(operations).every(
					([id, operation]) => id === operation.id,
				),
			{ message: `SVG register operation map keys must match operation IDs` },
		)
		.refine(
			({ history }) =>
				Object.entries(history ?? {}).every(
					([id, operation]) => id === operation.id,
				),
			{ message: `SVG register history map keys must match operation IDs` },
		)
}

export const EMPTY_SVG_ORDER: SvgOrderState = { operations: {} }

export function emptySvgRegister<Value>(): SvgRegisterState<Value> {
	return { operations: {} }
}

/** Locale-independent ordering used by every SVG convergence decision. */
export function compareSvgIds(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
	let a = left < 0n ? -left : left
	let b = right < 0n ? -right : right
	while (b !== 0n) {
		const remainder = a % b
		a = b
		b = remainder
	}
	return a === 0n ? 1n : a
}

function normalizeRank(numerator: bigint, denominator: bigint): SvgOrderRank {
	if (denominator <= 0n) {
		throw new Error(`An SVG order rank denominator must be positive`)
	}
	const divisor = greatestCommonDivisor(numerator, denominator)
	return {
		denominator: (denominator / divisor).toString(),
		numerator: (numerator / divisor).toString(),
	}
}

/** Produce a stable rational rank strictly between the supplied neighbors. */
export function rankSvgOrderBetween(
	left: SvgOrderRank | null,
	right: SvgOrderRank | null,
): SvgOrderRank {
	if (left === null && right === null) return normalizeRank(0n, 1n)
	if (left === null) {
		const numerator = BigInt(right!.numerator)
		const denominator = BigInt(right!.denominator)
		return normalizeRank(numerator - denominator, denominator)
	}
	if (right === null) {
		const numerator = BigInt(left.numerator)
		const denominator = BigInt(left.denominator)
		return normalizeRank(numerator + denominator, denominator)
	}
	if (compareSvgOrderRanks(left, right) >= 0) {
		throw new Error(`SVG order neighbors must be strictly increasing`)
	}
	return normalizeRank(
		BigInt(left.numerator) + BigInt(right.numerator),
		BigInt(left.denominator) + BigInt(right.denominator),
	)
}

export function compareSvgOrderRanks(
	left: SvgOrderRank,
	right: SvgOrderRank,
): number {
	const difference =
		BigInt(left.numerator) * BigInt(right.denominator) -
		BigInt(right.numerator) * BigInt(left.denominator)
	return difference < 0n ? -1 : difference > 0n ? 1 : 0
}

function operationsMatch(
	left: SvgOrderOperation,
	right: SvgOrderOperation,
): boolean {
	return (
		left.entryId === right.entryId &&
		left.actor === right.actor &&
		left.id === right.id &&
		left.present === right.present &&
		left.rank.denominator === right.rank.denominator &&
		left.rank.numerator === right.rank.numerator &&
		left.value === right.value
	)
}

function historyMatches(
	left: SvgHistoryOperation,
	right: SvgHistoryOperation,
): boolean {
	const rightTargets = new Set(right.targetOperationIds)
	return (
		left.actor === right.actor &&
		left.id === right.id &&
		left.mode === right.mode &&
		left.targetOperationIds.length === right.targetOperationIds.length &&
		left.targetOperationIds.every((target) => rightTargets.has(target))
	)
}

function jsonValuesMatch(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true
	if (typeof left !== `object` || left === null) return false
	if (typeof right !== `object` || right === null) return false
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right)) return false
		return (
			left.length === right.length &&
			left.every((value, index) => jsonValuesMatch(value, right[index]))
		)
	}
	const leftRecord = left as Record<string, unknown>
	const rightRecord = right as Record<string, unknown>
	const leftKeys = Object.keys(leftRecord)
	const rightKeys = Object.keys(rightRecord)
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key) =>
				Object.hasOwn(rightRecord, key) &&
				jsonValuesMatch(leftRecord[key], rightRecord[key]),
		)
	)
}

function activeSvgOperations<
	Operation extends { actor?: string | undefined; id: string },
>(
	operations: Iterable<Operation>,
	history: Iterable<SvgHistoryOperation>,
): readonly Operation[] {
	const changes = [...operations]
	const byId = new Map(changes.map((operation) => [operation.id, operation]))
	const counts = new Map<string, { redo: number; undo: number }>()
	for (const operation of history) {
		for (const targetId of operation.targetOperationIds) {
			const target = byId.get(targetId)
			if (target?.actor !== operation.actor || target === undefined) {
				throw new Error(`SVG history targeted an unknown or foreign operation`)
			}
			const count = counts.get(targetId) ?? { redo: 0, undo: 0 }
			count[operation.mode]++
			counts.set(targetId, count)
		}
	}
	return changes.filter((operation) => {
		const count = counts.get(operation.id) ?? { redo: 0, undo: 0 }
		if (count.undo < count.redo || count.undo > count.redo + 1) {
			throw new Error(`SVG history modes do not form an alternating cursor`)
		}
		return count.undo === count.redo
	})
}

/**
 * Accumulate an idempotent order operation. Materialization is independent of
 * delivery order, making this reducer suitable for MOS-11 member registration.
 */
export function reduceSvgOrder(
	state: SvgOrderState,
	operation: SvgOrderModelOperation,
): SvgOrderState {
	const normalized = svgOrderModelOperationSchema.parse(operation)
	if (`type` in normalized) {
		const previous = state.history?.[normalized.id]
		if (previous !== undefined) {
			if (!historyMatches(previous, normalized)) {
				throw new Error(`SVG order history ID collision: ${normalized.id}`)
			}
			return state
		}
		const next = {
			history: { ...state.history, [normalized.id]: normalized },
			operations: state.operations,
		}
		activeSvgOperations(
			Object.values(next.operations),
			Object.values(next.history),
		)
		return next
	}
	const previous = state.operations[normalized.id]
	if (previous !== undefined) {
		if (!operationsMatch(previous, normalized)) {
			throw new Error(`SVG order operation ID collision: ${normalized.id}`)
		}
		return state
	}
	return {
		...(state.history === undefined ? {} : { history: state.history }),
		operations: { ...state.operations, [normalized.id]: normalized },
	}
}

function latestSvgOrderOperations(
	state: SvgOrderState,
): ReadonlyMap<string, SvgOrderOperation> {
	const latest = new Map<string, SvgOrderOperation>()
	for (const operation of activeSvgOperations(
		Object.values(state.operations),
		Object.values(state.history ?? {}),
	)) {
		const previous = latest.get(operation.entryId)
		if (previous === undefined || compareSvgIds(previous.id, operation.id) < 0) {
			latest.set(operation.entryId, operation)
		}
	}
	return latest
}

/** Materialize the current sequence without turning it into a parallel registry. */
export function materializeSvgOrder(
	state: SvgOrderState,
): readonly SvgOrderedEntry[] {
	return [...latestSvgOrderOperations(state).values()]
		.filter(({ present }) => present)
		.map(({ entryId, rank, value }) => ({ entryId, rank, value }))
		.sort((left, right) => {
			const byRank = compareSvgOrderRanks(left.rank, right.rank)
			return byRank === 0 ? compareSvgIds(left.entryId, right.entryId) : byRank
		})
}

export function placeSvgOrderEntry(
	state: SvgOrderState,
	options: {
		readonly entryId: string
		readonly id: string
		readonly index: number
		readonly value: string
	},
): SvgOrderState {
	const withoutEntry = materializeSvgOrder(state).filter(
		({ entryId }) => entryId !== options.entryId,
	)
	const index = Math.max(0, Math.min(options.index, withoutEntry.length))
	return reduceSvgOrder(state, {
		entryId: options.entryId,
		id: options.id,
		present: true,
		rank: rankSvgOrderBetween(
			withoutEntry[index - 1]?.rank ?? null,
			withoutEntry[index]?.rank ?? null,
		),
		value: options.value,
	})
}

export function removeSvgOrderEntry(
	state: SvgOrderState,
	entryId: string,
	id: string,
): SvgOrderState {
	const current = latestSvgOrderOperations(state).get(entryId)
	if (current === undefined) return state
	return reduceSvgOrder(state, { ...current, id, present: false })
}

/**
 * A deterministic last-operation-wins register with delivery-order-independent
 * duplicate protection and model-owned actor-selective compensation.
 */
export function reduceSvgRegister<Value>(
	state: SvgRegisterState<Value>,
	operation: SvgRegisterModelOperation<Value>,
): SvgRegisterState<Value> {
	if (`type` in operation) {
		const normalized = svgHistoryOperationSchema.parse(operation)
		const previous = state.history?.[normalized.id]
		if (previous !== undefined) {
			if (!historyMatches(previous, normalized)) {
				throw new Error(`SVG register history ID collision: ${normalized.id}`)
			}
			return state
		}
		const next = {
			history: { ...state.history, [normalized.id]: normalized },
			operations: state.operations,
		}
		activeSvgOperations(
			Object.values(next.operations),
			Object.values(next.history),
		)
		return next
	}
	const previous = state.operations[operation.id]
	if (previous === undefined) {
		const next = structuredClone(operation)
		return {
			...(state.history === undefined ? {} : { history: state.history }),
			operations: { ...state.operations, [next.id]: next },
		}
	}
	if (
		previous.actor !== operation.actor ||
		previous.id !== operation.id ||
		!jsonValuesMatch(previous.value, operation.value)
	) {
		throw new Error(`SVG register operation ID collision: ${operation.id}`)
	}
	return state
}

export function readSvgRegister<Value>(
	state: SvgRegisterState<Value>,
): Value | undefined {
	let latest: SvgRegisterOperation<Value> | undefined
	for (const operation of activeSvgOperations(
		Object.values(state.operations),
		Object.values(state.history ?? {}),
	)) {
		if (latest === undefined || compareSvgIds(latest.id, operation.id) < 0) {
			latest = operation
		}
	}
	return latest?.value
}

function compactedHistory(
	operations: Readonly<
		Record<string, { readonly actor?: string | undefined; readonly id: string }>
	>,
	history: Readonly<Record<string, SvgHistoryOperation>> | undefined,
	retainedOperationIds: ReadonlySet<string>,
	throughRevision: number,
): Readonly<Record<string, SvgHistoryOperation>> | undefined {
	const active = new Set(
		activeSvgOperations(
			Object.values(operations),
			Object.values(history ?? {}),
		).map(({ id }) => id),
	)
	const compacted: Record<string, SvgHistoryOperation> = {}
	for (const targetId of [...retainedOperationIds].sort()) {
		const target = operations[targetId]
		if (target === undefined || active.has(targetId)) continue
		if (target.actor === undefined) {
			throw new Error(`SVG history cannot compact an unauthored operation`)
		}
		const id = `svg-history-cut:${throughRevision.toString()}:${targetId}`
		compacted[id] = {
			actor: target.actor,
			id,
			mode: `undo`,
			targetOperationIds: [targetId],
			type: `history`,
		}
	}
	return Object.keys(compacted).length === 0 ? undefined : compacted
}

/** Fold retired register receipts while preserving visible and protected state. */
export function compactSvgRegisterHistory<Value>(
	state: SvgRegisterState<Value>,
	context: {
		readonly retainedOperationIds: ReadonlySet<string>
		readonly throughRevision: number
	},
): SvgRegisterState<Value> {
	const active = activeSvgOperations(
		Object.values(state.operations),
		Object.values(state.history ?? {}),
	)
	const latest = active.reduce<SvgRegisterOperation<Value> | undefined>(
		(current, operation) =>
			current === undefined || compareSvgIds(current.id, operation.id) < 0
				? operation
				: current,
		undefined,
	)
	const keep = new Set(context.retainedOperationIds)
	if (latest !== undefined) keep.add(latest.id)
	const operations = Object.fromEntries(
		Object.entries(state.operations).filter(([id]) => keep.has(id)),
	)
	const history = compactedHistory(
		state.operations,
		state.history,
		context.retainedOperationIds,
		context.throughRevision,
	)
	return {
		...(history === undefined ? {} : { history }),
		operations,
	}
}

/** Fold retired ordering receipts to one visible decision per resource. */
export function compactSvgOrderHistory(
	state: SvgOrderState,
	context: {
		readonly retainedOperationIds: ReadonlySet<string>
		readonly throughRevision: number
	},
): SvgOrderState {
	const keep = new Set(context.retainedOperationIds)
	for (const operation of latestSvgOrderOperations(state).values()) {
		keep.add(operation.id)
	}
	const operations = Object.fromEntries(
		Object.entries(state.operations).filter(([id]) => keep.has(id)),
	)
	const history = compactedHistory(
		state.operations,
		state.history,
		context.retainedOperationIds,
		context.throughRevision,
	)
	return {
		...(history === undefined ? {} : { history }),
		operations,
	}
}
