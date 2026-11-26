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
		beforeEmpty: true,
		afterEmpty: false,
		truncated: false,
		comparisonLimited: false,
		entries: [
			{
				position: 0,
				label: `0`,
				before: undefined,
				after: { value: `coffee-beans` },
				changed: true,
			},
		],
	})
	const sparse: (number | undefined)[] = Array(4)
	sparse[1] = undefined
	sparse[2] = 2
	const next: (number | undefined)[] = Array(4)
	next[0] = undefined
	next[2] = 3
	expect(
		historyCollectionChanges(sparse, next)?.entries.map((entry) => [
			entry.label,
			describeOutcomeValue(entry.before?.value).text,
			describeOutcomeValue(entry.after?.value).text,
			entry.changed,
		]),
	).toEqual([
		[`0`, `<empty>`, `undefined`, true],
		[`1`, `undefined`, `<empty>`, true],
		[`2`, `2`, `3`, true],
		[`3`, `<empty>`, `<empty>`, false],
	])
	const large = Array.from({ length: 100 }, (_, index) => index)
	const append = historyCollectionChanges(large, [...large, 100])!
	expect(append).toMatchObject({
		beforeSize: 100,
		afterSize: 101,
		truncated: true,
	})
	expect(append.entries[0]).toMatchObject({ label: `000`, changed: false })
	expect(append.entries.at(-1)).toMatchObject({
		label: `100`,
		after: { value: 100 },
		changed: true,
	})
	expect(
		historyCollectionChanges([...large, 100], large)?.entries.at(-1),
	).toMatchObject({
		label: `100`,
		before: { value: 100 },
	})
})

it(`keeps distant edits inside the array preview and reports sampled comparisons`, () => {
	const before: string[] = Array.from({ length: 110 }, () => `stock`)
	const after = [...before]
	after[7] = `tomato`
	after[100] = `eggplant`
	const changes = historyCollectionChanges(before, after)!
	expect(changes.entries).toHaveLength(32)
	expect(changes.comparisonLimited).toBe(false)
	expect(changes.entries.filter((entry) => entry.changed)).toEqual([
		{
			position: 7,
			label: `007`,
			before: { value: `stock` },
			after: { value: `tomato` },
			changed: true,
		},
		{
			position: 100,
			label: `100`,
			before: { value: `stock` },
			after: { value: `eggplant` },
			changed: true,
		},
	])
	const large: string[] = Array(5000)
	const appended: string[] = Array(5001)
	appended[5000] = `eggplant`
	const sampled = historyCollectionChanges(large, appended)!
	expect(sampled.comparisonLimited).toBe(true)
	expect(sampled.entries.at(-1)).toMatchObject({
		position: 5000,
		label: `5000`,
		changed: true,
	})
	const sparse: string[] = Array(110)
	sparse[100] = `eggplant`
	expect(
		historyCollectionChanges([], sparse)?.entries.filter(
			(entry) => entry.changed,
		),
	).toMatchObject([
		{ position: 100, label: `100`, after: { value: `eggplant` } },
	])
})

it(`reports changed record properties, map entries and set membership`, () => {
	expect(
		historyCollectionChanges(
			{ same: { x: 1 }, changed: 1, gone: false },
			{ same: { x: 1 }, changed: 2, added: null },
		)?.entries,
	).toMatchObject([
		{
			label: `same`,
			before: { value: { x: 1 } },
			after: { value: { x: 1 } },
			changed: false,
		},
		{
			label: `changed`,
			before: { value: 1 },
			after: { value: 2 },
			changed: true,
		},
		{ label: `gone`, before: { value: false }, after: undefined, changed: true },
		{ label: `added`, before: undefined, after: { value: null }, changed: true },
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
	).toMatchObject([
		{
			label: `"count"`,
			before: { value: 1 },
			after: { value: 2 },
			changed: true,
		},
		{ label: `"gone"`, before: { value: 5 }, after: undefined, changed: true },
		{ label: `"fresh"`, before: undefined, after: { value: 4 }, changed: true },
	])
	expect(
		historyCollectionChanges(new Set([`old`, `same`]), new Set([`same`, `new`]))
			?.entries,
	).toMatchObject([
		{ label: ``, before: { value: `old` }, after: undefined, changed: true },
		{
			label: ``,
			before: { value: `same` },
			after: { value: `same` },
			changed: false,
		},
		{ label: ``, before: undefined, after: { value: `new` }, changed: true },
	])
	const long = new Map(Array.from({ length: 35 }, (_, index) => [index, index]))
	const reordered = historyCollectionChanges(long, new Map([...long].reverse()))!
	expect(reordered.truncated).toBe(true)
	expect(reordered.entries).toHaveLength(35)
	expect(reordered.entries.some((entry) => entry.changed)).toBe(false)
	const hidden = Object.defineProperty({}, `internal`, { value: 1 })
	expect(historyCollectionChanges(hidden, {})).toMatchObject({
		beforeEmpty: true,
		afterEmpty: true,
		entries: [],
	})
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
	expect(historyCollectionChanges([0], [-0])?.entries[0]?.changed).toBe(true)
	expect(
		historyCollectionChanges([{ a: 1 }], [{ a: 2 }])?.entries[0]?.changed,
	).toBe(true)
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

it(`keeps existing array values aligned when prepending one item`, () => {
	const before = [`filters`, `mug`]
	const after = [`coffee`, ...before]
	for (const [previous, next] of [
		[before, after],
		[after, before],
	] as const) {
		const entries = historyCollectionChanges(previous, next)!.entries
		expect(
			entries.map((entry) => [
				entry.before?.value,
				entry.after?.value,
				entry.changed,
			]),
		).toEqual([
			previous === before
				? [undefined, `coffee`, true]
				: [`coffee`, undefined, true],
			[`filters`, `filters`, false],
			[`mug`, `mug`, false],
		])
	}
})
