import { expect, it, vi } from "vitest"

import {
	describeOutcomeValue,
	historyCollectionChanges,
} from "../src/history-value.ts"

it(`reports array lengths and actual indexed changes, including holes and long appends`, () => {
	expect(historyCollectionChanges([], [`coffee-beans`])).toEqual({
		kind: `Array`,
		beforeSize: 0,
		afterSize: 1,
		truncated: false,
		entries: [
			{ label: `[0]`, before: undefined, after: { value: `coffee-beans` } },
		],
	})
	const sparse: (number | undefined)[] = Array(4)
	sparse[1] = undefined
	sparse[2] = 2
	const next: (number | undefined)[] = Array(4)
	next[0] = undefined
	next[2] = 3
	expect(historyCollectionChanges(sparse, next)?.entries).toEqual([
		{ label: `[0]`, before: undefined, after: { value: undefined } },
		{ label: `[1]`, before: { value: undefined }, after: undefined },
		{ label: `[2]`, before: { value: 2 }, after: { value: 3 } },
	])
	const large = Array.from({ length: 100 }, (_, index) => index)
	expect(historyCollectionChanges(large, [...large, 100])).toMatchObject({
		beforeSize: 100,
		afterSize: 101,
		truncated: true,
		entries: [{ label: `[100]`, after: { value: 100 } }],
	})
	expect(
		historyCollectionChanges([...large, 100], large)?.entries[0],
	).toMatchObject({
		label: `[100]`,
		before: { value: 100 },
	})
})

it(`reports changed record properties, map entries and set membership`, () => {
	expect(
		historyCollectionChanges(
			{ same: { x: 1 }, changed: 1, gone: false },
			{ same: { x: 1 }, changed: 2, added: null },
		)?.entries,
	).toEqual([
		{ label: `changed`, before: { value: 1 }, after: { value: 2 } },
		{ label: `gone`, before: { value: false }, after: undefined },
		{ label: `added`, before: undefined, after: { value: null } },
	])
	expect(
		historyCollectionChanges(
			new Map([
				[`count`, 1],
				[`gone`, 5],
			]),
			new Map([
				[`count`, 2],
				[`fresh`, 4],
			]),
		)?.entries,
	).toEqual([
		{ label: `"count"`, before: { value: 1 }, after: { value: 2 } },
		{ label: `"gone"`, before: { value: 5 }, after: undefined },
		{ label: `"fresh"`, before: undefined, after: { value: 4 } },
	])
	expect(
		historyCollectionChanges(new Set([`old`, `same`]), new Set([`same`, `new`]))
			?.entries,
	).toEqual([
		{ label: ``, before: { value: `old` }, after: undefined },
		{ label: ``, before: undefined, after: { value: `new` } },
	])
	const long = new Map(Array.from({ length: 35 }, (_, index) => [index, index]))
	expect(
		historyCollectionChanges(long, new Map([...long].reverse())),
	).toMatchObject({ truncated: true, entries: [] })
	expect(historyCollectionChanges({ a: 1 }, [1])).toBeUndefined()
	expect(historyCollectionChanges(undefined, [1])).toBeUndefined()
	expect(historyCollectionChanges({ a: 1 }, undefined)).toBeUndefined()
})

it(`renders bounded literal previews without reading getters or calling custom formatters`, () => {
	const getter = vi.fn(() => {
		throw new Error(`getter`)
	})
	const formatter = vi.fn(() => {
		throw new Error(`formatter`)
	})
	const record = Object.create(null) as Record<string, unknown>
	record[`value`] = `quoted "string"`
	record[`toJSON`] = formatter
	record[`self`] = record
	Object.defineProperty(record, `computed`, { enumerable: true, get: getter })
	Object.defineProperty(record, `hidden`, { value: 12 })
	expect(describeOutcomeValue(record, true)).toEqual({
		text: `{"value": "quoted \\"string\\"", "toJSON": [opaque], "self": [circular], "computed": [accessor]}`,
		complete: false,
		truncated: false,
	})
	const source: unknown[] = Array(2)
	Object.defineProperty(source, `1`, { get: getter })
	expect(describeOutcomeValue(source).text).toBe(`[<empty>, [accessor]]`)
	expect(getter).not.toHaveBeenCalled()
	expect(formatter).not.toHaveBeenCalled()
	expect(describeOutcomeValue(new Map([[`x`, 1n]])).text).toBe(
		`Map(1) {"x": 1n}`,
	)
	expect(describeOutcomeValue(new Set([Symbol(`key`)])).text).toBe(
		`Set(1) {Symbol(key)}`,
	)
	expect(describeOutcomeValue(new Date(0)).text).toBe(
		`Date(1970-01-01T00:00:00.000Z)`,
	)
	expect(describeOutcomeValue(new Date(NaN)).text).toBe(`Invalid Date`)
	const invalid = new Proxy([], {
		getOwnPropertyDescriptor: () => ({
			value: NaN,
			writable: true,
			configurable: false,
			enumerable: false,
		}),
	})
	expect(describeOutcomeValue(invalid).text).toBe(`[opaque]`)
	expect(describeOutcomeValue(-0).text).toBe(`-0`)
	expect(describeOutcomeValue([0, 1, 2, 3, 4]).text).toBe(`[0, 1, 2, 3, …]`)
	expect(historyCollectionChanges([0], [-0])?.entries[0]?.label).toBe(`[0]`)
	expect(
		historyCollectionChanges([{ a: 1 }], [{ a: 2 }])?.entries[0]?.label,
	).toBe(`[0]`)
	expect(describeOutcomeValue(/test/).text).toBe(`[opaque]`)
	expect(describeOutcomeValue({ a: { b: { c: 1 } } })).toMatchObject({
		text: `{"a": {"b": Object(…)}}`,
		truncated: true,
	})
	expect(
		describeOutcomeValue(
			Array.from({ length: 32 }, () => ({ one: 1, two: 2 })),
			true,
		).truncated,
	).toBe(true)
	expect(describeOutcomeValue(`x`.repeat(130)).text).toBe(
		`"${`x`.repeat(120)}"…`,
	)
	expect(
		describeOutcomeValue(
			new Proxy(
				{},
				{
					ownKeys() {
						throw new Error(`unavailable`)
					},
				},
			),
		).text,
	).toBe(`[opaque]`)
	const blocked = new Proxy([], {
		getOwnPropertyDescriptor() {
			throw new Error(`unavailable`)
		},
	})
	expect(historyCollectionChanges([], blocked)).toBeUndefined()
})
