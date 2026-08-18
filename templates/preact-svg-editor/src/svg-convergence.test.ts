import { describe, expect, test } from "vitest"

import {
	compactSvgOrderHistory,
	compactSvgRegisterHistory,
	EMPTY_SVG_ORDER,
	emptySvgRegister,
	materializeSvgOrder,
	rankSvgOrderBetween,
	readSvgRegister,
	reduceSvgOrder,
	reduceSvgRegister,
	type SvgOrderOperation,
} from "./svg-convergence.ts"

describe(`SVG member convergence`, () => {
	test(`order members converge under contention, reordering, and duplicates`, () => {
		const middle = rankSvgOrderBetween(null, null)
		const before = rankSvgOrderBetween(null, middle)
		const operations: SvgOrderOperation[] = [
			{
				entryId: `a`,
				id: `0001:alice:insert-a`,
				present: true,
				rank: middle,
				value: `path-a`,
			},
			{
				entryId: `b`,
				id: `0001:bob:insert-b`,
				present: true,
				rank: middle,
				value: `path-b`,
			},
			{
				entryId: `a`,
				id: `0002:alice:move-a`,
				present: true,
				rank: before,
				value: `path-a`,
			},
		]
		const apply = (delivery: readonly SvgOrderOperation[]) =>
			delivery.reduce(reduceSvgOrder, EMPTY_SVG_ORDER)
		const forward = apply([...operations, operations[1]])
		const reverse = apply([...operations].reverse())

		expect(materializeSvgOrder(forward)).toEqual(materializeSvgOrder(reverse))
		expect(materializeSvgOrder(forward).map(({ value }) => value)).toEqual([
			`path-a`,
			`path-b`,
		])
	})

	test(`same-node contention is deterministic without a mutex`, () => {
		const alice = { id: `0007:alice:drag`, value: { x: 10, y: 20 } }
		const bob = { id: `0007:bob:drag`, value: { x: 30, y: 40 } }
		const first = reduceSvgRegister(
			reduceSvgRegister(emptySvgRegister(), alice),
			bob,
		)
		const second = reduceSvgRegister(
			reduceSvgRegister(emptySvgRegister(), bob),
			alice,
		)

		expect(first).toEqual(second)
		expect(readSvgRegister(first)).toEqual({ x: 30, y: 40 })
	})

	test(`operation ID collisions fail closed`, () => {
		const initial = reduceSvgRegister(emptySvgRegister(), {
			id: `same`,
			value: { x: 1, y: 1 },
		})
		expect(() =>
			reduceSvgRegister(initial, { id: `same`, value: { x: 2, y: 2 } }),
		).toThrow(`operation ID collision`)
	})

	test(`superseded operation ID collisions fail in every delivery order`, () => {
		const old = { id: `0001`, value: { x: 1, y: 1 } }
		const latest = { id: `0002`, value: { x: 2, y: 2 } }
		const collision = { id: old.id, value: { x: 3, y: 3 } }
		const apply = (operations: readonly (typeof old)[]) =>
			operations.reduce(reduceSvgRegister, emptySvgRegister())

		expect(() => apply([old, latest, collision])).toThrow(
			`operation ID collision`,
		)
		expect(() => apply([latest, old, collision])).toThrow(
			`operation ID collision`,
		)
	})

	test(`compensation target sets are idempotent regardless of wire order`, () => {
		const firstOrder: SvgOrderOperation = {
			actor: `alice`,
			entryId: `a`,
			id: `first`,
			present: false,
			rank: rankSvgOrderBetween(null, null),
			value: `path-a`,
		}
		const orderOperation = {
			actor: `alice`,
			id: `undo`,
			mode: `undo` as const,
			targetOperationIds: [`first`, `second`],
			type: `history` as const,
		}
		const orderChanges = reduceSvgOrder(
			reduceSvgOrder(EMPTY_SVG_ORDER, firstOrder),
			{ ...firstOrder, id: `second` },
		)
		const order = reduceSvgOrder(orderChanges, orderOperation)
		expect(
			reduceSvgOrder(order, {
				...orderOperation,
				targetOperationIds: [`second`, `first`],
			}),
		).toBe(order)

		const registerChanges = reduceSvgRegister(
			reduceSvgRegister(emptySvgRegister(), {
				actor: `alice`,
				id: `first`,
				value: { x: 0, y: 1 },
			}),
			{ actor: `alice`, id: `second`, value: { x: 1, y: 2 } },
		)
		const registerOperation = {
			actor: `alice`,
			id: `undo`,
			mode: `undo` as const,
			targetOperationIds: [`first`, `second`],
			type: `history` as const,
		}
		const register = reduceSvgRegister(registerChanges, registerOperation)
		expect(
			reduceSvgRegister(register, {
				...registerOperation,
				targetOperationIds: [`second`, `first`],
			}),
		).toBe(register)
	})

	test(`a malformed or foreign compensation target fails closed`, () => {
		expect(() =>
			reduceSvgRegister(emptySvgRegister(), {
				actor: `alice`,
				id: `undo`,
				mode: `undo`,
				targetOperationIds: [`missing`],
				type: `history`,
			}),
		).toThrow(`unknown or foreign`)
	})

	test(`compaction survives restart and preserves protected redo targets`, () => {
		const registerChanges = [
			{ actor: `alice`, id: `0001`, value: { x: 1, y: 1 } },
			{ actor: `alice`, id: `0002`, value: { x: 2, y: 2 } },
			{ actor: `alice`, id: `0003`, value: { x: 3, y: 3 } },
		].reduce(reduceSvgRegister, emptySvgRegister<{ x: number; y: number }>())
		const undoneRegister = reduceSvgRegister(registerChanges, {
			actor: `alice`,
			id: `undo-0003`,
			mode: `undo`,
			targetOperationIds: [`0003`],
			type: `history`,
		})
		const compactedRegister = compactSvgRegisterHistory(undoneRegister, {
			retainedOperationIds: new Set([`0003`]),
			throughRevision: 9,
		})
		const restartedRegister = structuredClone(compactedRegister)
		expect(Object.keys(restartedRegister.operations)).toEqual([`0002`, `0003`])
		expect(Object.keys(restartedRegister.history ?? {})).toEqual([
			`svg-history-cut:9:0003`,
		])
		expect(readSvgRegister(restartedRegister)).toEqual({ x: 2, y: 2 })
		expect(
			readSvgRegister(
				reduceSvgRegister(restartedRegister, {
					actor: `alice`,
					id: `redo-0003`,
					mode: `redo`,
					targetOperationIds: [`0003`],
					type: `history`,
				}),
			),
		).toEqual({ x: 3, y: 3 })

		const rank = rankSvgOrderBetween(null, null)
		const orderChanges = [
			{
				actor: `alice`,
				entryId: `path`,
				id: `0001`,
				present: true,
				rank,
				value: `old`,
			},
			{
				actor: `alice`,
				entryId: `path`,
				id: `0002`,
				present: true,
				rank,
				value: `middle`,
			},
			{
				actor: `alice`,
				entryId: `path`,
				id: `0003`,
				present: true,
				rank,
				value: `latest`,
			},
		].reduce(reduceSvgOrder, EMPTY_SVG_ORDER)
		const undoneOrder = reduceSvgOrder(orderChanges, {
			actor: `alice`,
			id: `undo-order-0003`,
			mode: `undo`,
			targetOperationIds: [`0003`],
			type: `history`,
		})
		const restartedOrder = structuredClone(
			compactSvgOrderHistory(undoneOrder, {
				retainedOperationIds: new Set([`0003`]),
				throughRevision: 9,
			}),
		)
		expect(Object.keys(restartedOrder.operations)).toEqual([`0002`, `0003`])
		expect(
			materializeSvgOrder(restartedOrder).map(({ value }) => value),
		).toEqual([`middle`])
		expect(
			materializeSvgOrder(
				reduceSvgOrder(restartedOrder, {
					actor: `alice`,
					id: `redo-order-0003`,
					mode: `redo`,
					targetOperationIds: [`0003`],
					type: `history`,
				}),
			).map(({ value }) => value),
		).toEqual([`latest`])
	})
})
