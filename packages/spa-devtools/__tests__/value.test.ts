import { expect, it } from "vitest"

import { convert, describe, kind } from "../src/value.ts"

it(`classifies JSON and non-JSON values without traversing prototypes`, () => {
	for (const [value, expected] of [
		[null, `null`],
		[[], `array`],
		[{}, `object`],
		[Object.create(null), `object`],
		[``, `string`],
		[1, `number`],
		[true, `boolean`],
		[undefined, `other`],
		[new Date(), `other`],
		[() => 0, `other`],
	] as const)
		expect(kind(value)).toBe(expected)
})
it(`describes cycles and non-JSON values safely`, () => {
	const cycle: any = {}
	cycle.self = cycle
	expect(describe(cycle)).toBe(`{"self":"[Circular]"}`)
	expect(
		describe([1n, new Error(`bad`), new Map([[`x`, 1]]), new Set([2])]),
	).toBe(`["1n","Error: bad",{"Map":[["x",1]]},{"Set":[2]}]`)
	expect(describe(undefined)).toBe(`undefined`)
	expect(
		describe({
			toJSON() {
				throw new Error(`bad`)
			},
		}),
	).toBe(`[object Object]`)
})
it(`converts all JSON kinds with predictable empty and invalid values`, () => {
	for (const [type, value, expected] of [
		[`null`, 1, null],
		[`string`, null, ``],
		[`string`, `x`, `x`],
		[`string`, {}, `{}`],
		[`number`, [], 0],
		[`number`, `2`, 2],
		[`number`, `bad`, 0],
		[`boolean`, `true`, true],
		[`boolean`, `false`, false],
		[`boolean`, 0, false],
		[`array`, [1], [1]],
		[`array`, null, []],
		[`array`, { a: 1 }, [[`a`, 1]]],
		[`array`, 1, [1]],
		[`object`, { a: 1 }, { a: 1 }],
		[`object`, [`x`], { 0: `x` }],
		[`object`, null, {}],
		[`object`, 2, { value: 2 }],
	] as const)
		expect(convert(value, type)).toEqual(expected)
})
