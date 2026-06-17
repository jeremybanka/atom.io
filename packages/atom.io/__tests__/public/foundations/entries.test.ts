import type { Entries } from "atom.io/foundations/entries"
import { fromEntries, toEntries } from "atom.io/foundations/entries"

describe(`fromEntries`, () => {
	it(`type-safely converts an array of entries to an object`, () => {
		const myEntries = [
			[`a`, 1],
			[`b`, 1],
			[`c`, 1],
		] as const satisfies Entries
		const { a, b, c } = fromEntries(myEntries)
		expect(a + b + c).toBe(3)
	})
})

describe(`toEntries`, () => {
	it(`type-safely converts an object to entries`, () => {
		const entries = toEntries({ a: 1, b: 2 })
		expect(entries).toEqual([
			[`a`, 1],
			[`b`, 2],
		])
	})
})
