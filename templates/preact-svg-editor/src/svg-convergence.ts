import { z } from "zod"

export type SvgOrderRank = {
	readonly denominator: string
	readonly numerator: string
}

export type SvgOrderOperation = {
	readonly entryId: string
	readonly id: string
	readonly present: boolean
	readonly rank: SvgOrderRank
	readonly value: string
}

export type SvgOrderState = {
	readonly operations: Readonly<Record<string, SvgOrderOperation>>
}

export type SvgOrderedEntry = {
	readonly entryId: string
	readonly rank: SvgOrderRank
	readonly value: string
}

export type SvgRegisterOperation<Value> = {
	readonly id: string
	readonly value: Value
}

export type SvgRegisterState<Value> = {
	readonly operation: SvgRegisterOperation<Value> | null
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
		entryId: z.string().min(1),
		id: z.string().min(1),
		present: z.boolean(),
		rank: svgOrderRankSchema,
		value: z.string().min(1),
	})
	.strict()

export const svgOrderStateSchema: z.ZodType<SvgOrderState> = z
	.object({
		operations: z.record(z.string(), svgOrderOperationSchema),
	})
	.strict()
	.refine(
		({ operations }) =>
			Object.entries(operations).every(([id, operation]) => id === operation.id),
		{ message: `SVG order operation map keys must match operation IDs` },
	)

export function svgRegisterOperationSchema<Value>(
	valueSchema: z.ZodType<Value>,
): z.ZodType<SvgRegisterOperation<Value>> {
	return z.object({ id: z.string().min(1), value: valueSchema }).strict()
}

export function svgRegisterStateSchema<Value>(
	valueSchema: z.ZodType<Value>,
): z.ZodType<SvgRegisterState<Value>> {
	return z
		.object({ operation: svgRegisterOperationSchema(valueSchema).nullable() })
		.strict()
}

export const EMPTY_SVG_ORDER: SvgOrderState = { operations: {} }

export function emptySvgRegister<Value>(): SvgRegisterState<Value> {
	return { operation: null }
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
		left.id === right.id &&
		left.present === right.present &&
		left.rank.denominator === right.rank.denominator &&
		left.rank.numerator === right.rank.numerator &&
		left.value === right.value
	)
}

/**
 * Accumulate an idempotent order operation. Materialization is independent of
 * delivery order, making this reducer suitable for MOS-11 member registration.
 */
export function reduceSvgOrder(
	state: SvgOrderState,
	operation: SvgOrderOperation,
): SvgOrderState {
	const normalized = svgOrderOperationSchema.parse(operation)
	const previous = state.operations[normalized.id]
	if (previous !== undefined) {
		if (!operationsMatch(previous, normalized)) {
			throw new Error(`SVG order operation ID collision: ${normalized.id}`)
		}
		return state
	}
	return {
		operations: { ...state.operations, [normalized.id]: normalized },
	}
}

function latestSvgOrderOperations(
	state: SvgOrderState,
): ReadonlyMap<string, SvgOrderOperation> {
	const latest = new Map<string, SvgOrderOperation>()
	for (const operation of Object.values(state.operations)) {
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

/** A deterministic last-operation-wins register with duplicate protection. */
export function reduceSvgRegister<Value>(
	state: SvgRegisterState<Value>,
	operation: SvgRegisterOperation<Value>,
): SvgRegisterState<Value> {
	const previous = state.operation
	if (previous === null || compareSvgIds(previous.id, operation.id) < 0) {
		return { operation: structuredClone(operation) }
	}
	if (previous.id > operation.id) return state
	if (JSON.stringify(previous.value) !== JSON.stringify(operation.value)) {
		throw new Error(`SVG register operation ID collision: ${operation.id}`)
	}
	return state
}

export function readSvgRegister<Value>(
	state: SvgRegisterState<Value>,
): Value | undefined {
	return state.operation?.value
}
