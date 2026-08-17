import { describe, expect, test } from "vitest"

import {
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
})
