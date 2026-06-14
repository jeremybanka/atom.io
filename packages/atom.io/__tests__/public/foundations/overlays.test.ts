import { MapOverlay, SetOverlay } from "atom.io/foundations/overlays"

const setLikeWithPlainIterator = <T>(
	members: Iterable<T>,
): ReadonlySetLike<T> => {
	const memberSet = new Set(members)
	return {
		size: memberSet.size,
		has(value) {
			return memberSet.has(value)
		},
		keys() {
			const values = [...memberSet]
			let index = 0
			return {
				next(): IteratorResult<T> {
					if (index >= values.length) {
						return { done: true, value: undefined as never }
					}
					const value = values[index++]
					return { done: false, value }
				},
			}
		},
	}
}

describe(`MapOverlay`, () => {
	test(`constructor: binds source, starts empty overlay/deleted/changed; size reflects source`, () => {
		const source = new Map<string, number>([
			[`a`, 1],
			[`b`, 2],
		])
		const o = new MapOverlay(source)

		expect(o[`source`]).toBe(source)

		expect(o.size).toBe(2)

		expect(o.hasOwn(`a`)).toBe(false)
		expect(o.has(`a`)).toBe(true)
		expect(o.get(`a`)).toBe(1)
	})

	test(`set: adds overlay-only value, returns this, marks changed, clears deleted for that key`, () => {
		const source = new Map<string, number>([[`a`, 1]])
		const o = new MapOverlay<string, number>(source)

		const ret = o.set(`x`, 9) // overlay-only
		expect(ret).toBe(o)
		expect(o.hasOwn(`x`)).toBe(true)
		expect(o.has(`x`)).toBe(true)
		expect(o.get(`x`)).toBe(9)

		expect(o.size).toBe(2)

		const ret2 = o.set(`a`, 10)
		expect(ret2).toBe(o)
		expect(o.get(`a`)).toBe(10)
		expect(o.hasOwn(`a`)).toBe(true)

		expect(o.size).toBe(2)

		o.set(`a`, 11)
		expect(o.get(`a`)).toBe(11)
	})

	test(`get: overlay hit, source hit, deleted, missing; overlay may store undefined`, () => {
		const source = new Map<string, number | undefined>([
			[`a`, 1],
			[`b`, 2],
		])
		const o = new MapOverlay<string, number | undefined>(source)

		o.set(`x`, 100)
		expect(o.get(`x`)).toBe(100)

		o.set(`u`, undefined)
		expect(o.hasOwn(`u`)).toBe(true)
		expect(o.get(`u`)).toBeUndefined()

		expect(o.get(`a`)).toBe(1)

		o.delete(`a`)
		expect(o.get(`a`)).toBeUndefined()

		expect(o.get(`zzz` as any)).toBeUndefined()
	})

	test(`hasOwn vs has: overlay-only, source-only, deleted, missing`, () => {
		const source = new Map<string, number>([
			[`a`, 1],
			[`b`, 2],
		])
		const o = new MapOverlay<string, number>(source)

		o.set(`x`, 9)
		expect(o.hasOwn(`x`)).toBe(true)
		expect(o.has(`x`)).toBe(true)

		expect(o.hasOwn(`a`)).toBe(false)
		expect(o.has(`a`)).toBe(true)

		o.delete(`a`)
		expect(o.hasOwn(`a`)).toBe(false)
		expect(o.has(`a`)).toBe(false)

		expect(o.hasOwn(`zzz` as any)).toBe(false)
		expect(o.has(`zzz` as any)).toBe(false)
	})

	test(`delete: source-only returns false but marks deleted; overlay+source returns true and clears changed; overlay-only returns true`, () => {
		const source = new Map<string, number>([
			[`a`, 1],
			[`b`, 2],
		])
		const o = new MapOverlay<string, number>(source)

		o.set(`a`, 10)
		expect(o.changed.has(`a`)).toBe(true)
		const d1 = o.delete(`a`)
		expect(d1).toBe(true) // super.delete(true) on overlay entry

		expect(o.has(`a`)).toBe(false)

		const d2 = o.delete(`b`)
		expect(d2).toBe(false) // super.delete(false) (not in overlay)
		expect(o.has(`b`)).toBe(false)

		// overlay-only key
		o.set(`x`, 9)
		const d3 = o.delete(`x`)
		expect(d3).toBe(true)
		expect(o.hasOwn(`x`)).toBe(false)
		expect(o.has(`x`)).toBe(false)
	})

	test(`clear: no entries remain`, () => {
		const source = new Map<string, number>([
			[`a`, 1],
			[`b`, 2],
			[`c`, 3],
		])
		const o = new MapOverlay<string, number>(source)

		o.set(`x`, 100) // overlay-only
		o.set(`a`, 10) // changed (source key overridden)
		o.delete(`c`) // deleted (source key hidden)

		o.clear()
		expect(o.size).toBe(0)
		expect(o.has(`a`)).toBe(false)
		expect(o.has(`b`)).toBe(false)
		expect(o.has(`c`)).toBe(false)
		expect(o.has(`x`)).toBe(false)
	})

	test(`[Symbol.iterator]: source entries first with changed values, then overlay-only entries`, () => {
		const source = new Map<string, number>([
			[`a`, 1],
			[`b`, 2],
			[`c`, 3],
		])
		const o = new MapOverlay<string, number>(source)

		o.set(`x`, 100) // overlay-only
		o.set(`a`, 10) // changed (source key overridden)
		o.delete(`c`) // deleted (source key hidden)

		const iterated = [...o]
		expect(iterated).toEqual([
			[`a`, 10],
			[`b`, 2],
			[`x`, 100],
		])

		expect(Array.from(o.entries())).toEqual([
			[`a`, 10],
			[`b`, 2],
			[`x`, 100],
		])

		expect(o.size).toBe(3)
	})

	test(`keys(): source keys first, then overlay-only keys`, () => {
		const source = new Map<string, number>([
			[`a`, 1],
			[`b`, 2],
			[`c`, 3],
		])
		const o = new MapOverlay<string, number>(source)
		o.set(`x`, 100)
		o.set(`a`, 10)
		o.delete(`c`)

		expect(Array.from(o.keys())).toEqual([`a`, `b`, `x`])

		// If we also change 'b', it should be excluded from the source side
		o.set(`b`, 20)
		expect(Array.from(o.keys())).toEqual([`a`, `b`, `x`])
	})

	test(`values(): follows [Symbol.iterator]() order`, () => {
		const source = new Map<string, number>([
			[`a`, 1],
			[`b`, 2],
			[`c`, 3],
		])
		const o = new MapOverlay<string, number>(source)
		o.set(`x`, 100)
		o.set(`a`, 10)
		o.delete(`c`)

		expect(Array.from(o.values())).toEqual([10, 2, 100])

		// After modifying 'b'
		o.set(`b`, 20)
		expect(Array.from(o.values())).toEqual([10, 20, 100])
	})

	test(`forEach(callback): iterates in the same order and passes (value, key, map)`, () => {
		const source = new Map<string, number>([
			[`a`, 1],
			[`b`, 2],
			[`c`, 3],
		])
		const o = new MapOverlay<string, number>(source)
		o.set(`x`, 100)
		o.set(`a`, 10)
		o.delete(`c`)

		const seen: Array<[string, number, Map<string, number>]> = []
		o.forEach((value, key, map) => {
			seen.push([key, value, map])
		})

		expect(seen.map(([k, v]) => [k, v])).toEqual([
			[`a`, 10],
			[`b`, 2],
			[`x`, 100],
		])
		// map argument should be the overlay itself
		for (const [, , map] of seen) {
			expect(map).toBe(o)
		}
	})

	test(`forEach(callback, thisArg): calls callback with the provided receiver`, () => {
		const source = new Map<string, number>([[`a`, 1]])
		const o = new MapOverlay<string, number>(source)
		o.set(`x`, 2)
		const receiver = { seen: [] as Array<[string, number]> }

		o.forEach(function (this: typeof receiver, value, key) {
			this.seen.push([key, value])
		}, receiver)

		expect(receiver.seen).toEqual([
			[`a`, 1],
			[`x`, 2],
		])
	})

	test(`getOrInsert: returns existing values or inserts the default value for missing keys`, () => {
		const source = new Map<string, number | undefined>([
			[`a`, 1],
			[`u`, undefined],
		])
		const o = new MapOverlay<string, number | undefined>(source)

		expect(o.getOrInsert(`a`, 10)).toBe(1)
		expect(o.hasOwn(`a`)).toBe(false)
		expect(o.getOrInsert(`u`, 20)).toBeUndefined()
		expect(o.hasOwn(`u`)).toBe(false)

		expect(o.getOrInsert(`x`, 100)).toBe(100)
		expect(o.hasOwn(`x`)).toBe(true)
		expect(o.get(`x`)).toBe(100)
	})

	test(`getOrInsertComputed: computes only when the key is missing and passes the key`, () => {
		const source = new Map<string, number>([[`a`, 1]])
		const o = new MapOverlay<string, number>(source)
		o.set(`x`, 100)
		const callback = vi.fn((key: string) => key.length)

		expect(o.getOrInsertComputed(`a`, callback)).toBe(1)
		expect(o.getOrInsertComputed(`x`, callback)).toBe(100)
		expect(callback).not.toHaveBeenCalled()

		expect(o.getOrInsertComputed(`long`, callback)).toBe(4)
		expect(callback).toHaveBeenCalledExactlyOnceWith(`long`)
		expect(o.get(`long`)).toBe(4)
	})

	test(`size getter tracks super.size + source.size - changed.size - deleted.size through ops`, () => {
		const source = new Map<string, number>([
			[`a`, 1],
			[`b`, 2],
		])
		const o = new MapOverlay<string, number>(source)

		expect(o.size).toBe(2)

		o.set(`x`, 100)
		expect(o.size).toBe(3)

		o.set(`a`, 10)
		expect(o.size).toBe(3)

		o.delete(`b`)
		expect(o.size).toBe(2)

		o.delete(`x`)
		expect(o.size).toBe(1)

		o.delete(`a`)
		expect(o.size).toBe(0)
	})

	test(`clear: setting source-backed keys afterward uses fresh insertion order`, () => {
		const source = new Map<string, number>([
			[`a`, 1],
			[`b`, 2],
		])
		const o = new MapOverlay<string, number>(source)

		o.clear()
		o.set(`x`, 100)
		o.set(`a`, 10)

		expect(o.has(`a`)).toBe(true)
		expect(o.get(`a`)).toBe(10)
		expect(o.deleted).toEqual(new Set([`b`]))
		expect([...o]).toEqual([
			[`x`, 100],
			[`a`, 10],
		])
		expect(o.size).toBe(2)
	})
})

describe(`SetOverlay`, () => {
	test(`constructor: binds source, starts empty overlay, initial size equals source.size`, () => {
		const source = new Set([`a`, `b`])
		const o = new SetOverlay(source)

		// initial structure
		expect(o.source).toBe(source)
		expect(o.deleted.size).toBe(0)

		// initial size reflects source (overlay empty)
		expect(o.size).toBe(source.size)

		// baseline: hasOwn vs has for source-backed keys
		expect(o.hasOwn(`a`)).toBe(false)
		expect(o.has(`a`)).toBe(true)
	})

	test(`add: adds new values not in source to overlay; returns this; hasOwn true`, () => {
		const source = new Set([`a`, `b`])
		const o = new SetOverlay<string>(source)

		const ret = o.add(`x`) // not in source → goes into overlay
		expect(ret).toBe(o) // chaining
		expect(o.hasOwn(`x`)).toBe(true)
		expect(o.has(`x`)).toBe(true)

		// size = overlay(1) + source(2) - deleted(0) = 3
		expect(o.size).toBe(3)

		// adding the same overlay value again should be a no-op and return this
		const ret2 = o.add(`x`)
		expect(ret2).toBe(o)
		expect(o.size).toBe(3) // still 3
	})

	test(`add: when value exists in source, does not add to overlay and clears deletion`, () => {
		const source = new Set([`a`, `b`])
		const o = new SetOverlay<string>(source)

		// Delete a source-backed key → goes into deleted and has() becomes false
		expect(o.delete(`a`)).toBe(true)
		expect(o.has(`a`)).toBe(false)
		expect(o.hasOwn(`a`)).toBe(false)
		expect(o.size).toBe(1) // source(2) - deleted(1) + overlay(0) = 1

		// Re-adding a source-backed key should just clear deletion; not added to overlay
		const ret = o.add(`a`)
		expect(ret).toBe(o)
		expect(o.has(`a`)).toBe(true)
		expect(o.hasOwn(`a`)).toBe(false)
		expect(o.size).toBe(2) // source(2) - deleted(0) + overlay(0) = 2

		// Adding a source-backed key that was never deleted is a no-op but still returns this
		const ret2 = o.add(`b`)
		expect(ret2).toBe(o)
		expect(o.has(`b`)).toBe(true)
		expect(o.hasOwn(`b`)).toBe(false)
	})

	test(`hasOwn only checks overlay; has checks overlay OR source minus deleted`, () => {
		const source = new Set([`a`, `b`])
		const o = new SetOverlay<string>(source)

		// overlay-only value
		o.add(`x`)
		expect(o.hasOwn(`x`)).toBe(true)
		expect(o.has(`x`)).toBe(true)

		// source-only value
		expect(o.hasOwn(`a`)).toBe(false)
		expect(o.has(`a`)).toBe(true)

		// deleted source value
		expect(o.delete(`a`)).toBe(true)
		expect(o.hasOwn(`a`)).toBe(false)
		expect(o.has(`a`)).toBe(false)

		// completely missing value
		expect(o.hasOwn(`zzz` as any)).toBe(false)
		expect(o.has(`zzz` as any)).toBe(false)
	})

	test(`delete: source-backed returns true and marks deleted (even when repeated)`, () => {
		const source = new Set([`a`])
		const o = new SetOverlay<string>(source)

		// First delete of a source-backed key
		expect(o.delete(`a`)).toBe(true)
		expect(o.has(`a`)).toBe(false)
		expect(o.size).toBe(0) // source(1)-deleted(1)+overlay(0)=0

		// Deleting the same source-backed key again still returns true by design
		expect(o.delete(`a`)).toBe(true)
		expect(o.has(`a`)).toBe(false)
		expect(o.size).toBe(0)

		// Re-add (clears deletion) via add(value) since in source
		o.add(`a`)
		expect(o.has(`a`)).toBe(true)
		expect(o.size).toBe(1)
	})

	test(`delete: overlay-only returns boolean from super.delete (true if existed, false otherwise)`, () => {
		const source = new Set<string>([])
		const o = new SetOverlay<string>(source)

		// overlay add
		o.add(`x`)
		expect(o.hasOwn(`x`)).toBe(true)
		expect(o.size).toBe(1)

		// delete overlay value → true, removed from overlay
		expect(o.delete(`x`)).toBe(true)
		expect(o.hasOwn(`x`)).toBe(false)
		expect(o.has(`x`)).toBe(false)
		expect(o.size).toBe(0)

		// deleting something nonexistent → false
		expect(o.delete(`nope`)).toBe(false)
	})

	test(`clear: clears overlay, returns this, marks changed, clears deleted`, () => {
		const source = new Set<string>([`a`, `b`])
		const o = new SetOverlay<string>(source)
		// overlay add
		o.add(`x`)
		expect(o.hasOwn(`x`)).toBe(true)
		expect(o.size).toBe(3)

		// clear overlay
		o.clear()
		expect(o.hasOwn(`x`)).toBe(false)
		expect(o.size).toBe(0)
		expect(o.deleted).toEqual(new Set([`a`, `b`]))
	})

	test(`[Symbol.iterator]: yields source first, then overlay-only entries in insertion order`, () => {
		const source = new Set([`a`, `b`, `c`])
		const o = new SetOverlay<string>(source)

		// overlay items (in this order)
		o.add(`x`)
		o.add(`y`)

		// delete one source item to ensure it is skipped in iteration
		expect(o.delete(`b`)).toBe(true)

		// iteration: overlay first, then source minus deleted, preserving each set's order
		const iterated = [...o]
		expect(iterated).toEqual([`a`, `c`, `x`, `y`])

		// sanity: hasOwn shows overlay only; source 'b' stays in source but is filtered
		expect(o.hasOwn(`x`)).toBe(true)
		expect(o.hasOwn(`a`)).toBe(false)
		expect(o.has(`b`)).toBe(false)
	})

	test(`keys(), values(), and entries(): follow visible overlay order`, () => {
		const source = new Set([`a`, `b`, `c`])
		const o = new SetOverlay<string>(source)
		o.add(`x`)
		o.delete(`b`)

		expect([...o.keys()]).toEqual([`a`, `c`, `x`])
		expect([...o.values()]).toEqual([`a`, `c`, `x`])
		expect([...o.entries()]).toEqual([
			[`a`, `a`],
			[`c`, `c`],
			[`x`, `x`],
		])
	})

	test(`forEach(callback): iterates visible values and passes (value, value, set)`, () => {
		const source = new Set([`a`, `b`, `c`])
		const o = new SetOverlay<string>(source)
		o.add(`x`)
		o.delete(`b`)

		const seen: Array<[string, string, Set<string>]> = []
		o.forEach((value, value2, set) => {
			seen.push([value, value2, set])
		})

		expect(seen.map(([value, value2]) => [value, value2])).toEqual([
			[`a`, `a`],
			[`c`, `c`],
			[`x`, `x`],
		])
		for (const [, , set] of seen) {
			expect(set).toBe(o)
		}
	})

	test(`forEach(callback, thisArg): calls callback with the provided receiver`, () => {
		const source = new Set([`a`])
		const o = new SetOverlay<string>(source)
		o.add(`x`)
		const receiver = { seen: [] as string[] }

		o.forEach(function (this: typeof receiver, value) {
			this.seen.push(value)
		}, receiver)

		expect(receiver.seen).toEqual([`a`, `x`])
	})

	test(`iterateOwn(): yields only overlay entries (and in insertion order)`, () => {
		const source = new Set([`a`, `b`])
		const o = new SetOverlay<string>(source)

		o.add(`x`)
		o.add(`y`)

		// delete a source item to prove iterateOwn ignores source entirely
		o.delete(`a`)

		const own = [...o.iterateOwn()]
		expect(own).toEqual([`x`, `y`])
	})

	test(`size getter tracks overlay + source - deleted across operations`, () => {
		const source = new Set([`a`, `b`])
		const o = new SetOverlay<string>(source)

		// Start: 2
		expect(o.size).toBe(2)

		// Add overlay: +1
		o.add(`x`)
		expect(o.size).toBe(3)

		// Delete one source key: -1
		o.delete(`a`)
		expect(o.size).toBe(2)

		// Delete overlay key: -1
		o.delete(`x`)
		expect(o.size).toBe(1)

		// Re-add deleted source key via add (clears deletion): +1
		o.add(`a`)
		expect(o.size).toBe(2)
	})

	test(`union(): returns a Set containing visible overlay values and set-like operand values`, () => {
		const source = new Set([`a`, `b`, `c`])
		const o = new SetOverlay<string>(source)
		o.add(`x`)
		o.delete(`b`)

		const result = o.union(
			new Map<string, number>([
				[`c`, 3],
				[`d`, 4],
				[`x`, 100],
			]),
		)

		expect(result).toBeInstanceOf(Set)
		expect([...result]).toEqual([`a`, `c`, `x`, `d`])
	})

	test(`intersection(): returns values present in both the overlay and set-like operand`, () => {
		const source = new Set([`a`, `b`, `c`])
		const o = new SetOverlay<string>(source)
		o.add(`x`)
		o.delete(`b`)

		const sameSizeResult = o.intersection(
			new Map<string, number>([
				[`c`, 3],
				[`d`, 4],
				[`x`, 100],
			]),
		)
		expect([...sameSizeResult]).toEqual([`c`, `x`])

		const smallerOperandResult = o.intersection(new Set([`x`, `z`]))
		expect(smallerOperandResult.size).toBe(1)
		expect(smallerOperandResult.has(`x`)).toBe(true)
		expect(smallerOperandResult.has(`z`)).toBe(false)
	})

	test(`difference(): returns visible overlay values missing from the set-like operand`, () => {
		const source = new Set([`a`, `b`, `c`, `d`])
		const o = new SetOverlay<string>(source)
		o.add(`x`)
		o.delete(`b`)

		const largerOperandResult = o.difference(
			new Map<string, number>([
				[`c`, 3],
				[`x`, 100],
				[`z`, 0],
				[`q`, 0],
			]),
		)
		expect([...largerOperandResult]).toEqual([`a`, `d`])

		const smallerOperandResult = o.difference(new Set([`c`, `x`]))
		expect(smallerOperandResult.size).toBe(2)
		expect(smallerOperandResult.has(`a`)).toBe(true)
		expect(smallerOperandResult.has(`d`)).toBe(true)
	})

	test(`symmetricDifference(): returns values present in exactly one set-like operand`, () => {
		const source = new Set([`a`, `b`, `c`])
		const o = new SetOverlay<string>(source)
		o.add(`x`)
		o.delete(`b`)

		const result = o.symmetricDifference(
			new Map<string, number>([
				[`c`, 3],
				[`d`, 4],
				[`x`, 100],
			]),
		)

		expect([...result]).toEqual([`a`, `d`])
	})

	test(`set-like methods accept keys() results that are plain iterators`, () => {
		const source = new Set([`a`, `b`])
		const o = new SetOverlay<string>(source)
		o.add(`x`)
		o.delete(`b`)

		const operand = setLikeWithPlainIterator([`x`, `z`])

		expect([...o.union(operand)]).toEqual([`a`, `x`, `z`])
		expect([...o.intersection(operand)]).toEqual([`x`])
		expect(o.isSupersetOf(setLikeWithPlainIterator([`x`]))).toBe(true)
	})

	test(`isSubsetOf(): checks whether every visible overlay value is in the set-like operand`, () => {
		const source = new Set([`a`, `b`, `c`])
		const o = new SetOverlay<string>(source)
		o.add(`x`)
		o.delete(`b`)

		expect(o.isSubsetOf(new Set([`a`, `c`, `x`, `z`]))).toBe(true)
		expect(o.isSubsetOf(new Set([`a`, `c`]))).toBe(false)
		expect(o.isSubsetOf(new Set([`a`, `x`, `z`]))).toBe(false)
	})

	test(`isSupersetOf(): checks whether every set-like operand value is visible in the overlay`, () => {
		const source = new Set([`a`, `b`, `c`])
		const o = new SetOverlay<string>(source)
		o.add(`x`)
		o.delete(`b`)

		expect(
			o.isSupersetOf(
				new Map<string, number>([
					[`a`, 1],
					[`x`, 100],
				]),
			),
		).toBe(true)
		expect(o.isSupersetOf(new Set([`a`, `c`, `x`, `z`]))).toBe(false)
		expect(o.isSupersetOf(new Set([`a`, `b`]))).toBe(false)
	})

	test(`isDisjointFrom(): checks whether no values overlap with the set-like operand`, () => {
		const source = new Set([`a`, `b`, `c`, `d`])
		const o = new SetOverlay<string>(source)
		o.add(`x`)
		o.delete(`b`)

		expect(o.isDisjointFrom(new Set([`b`, `z`]))).toBe(true)
		expect(o.isDisjointFrom(new Set([`a`, `b`, `z`, `q`, `r`]))).toBe(false)
		expect(o.isDisjointFrom(new Set([`c`, `z`]))).toBe(false)
		expect(
			o.isDisjointFrom(
				new Map<string, number>([
					[`b`, 2],
					[`z`, 0],
					[`q`, 0],
					[`r`, 0],
					[`s`, 0],
				]),
			),
		).toBe(true)
	})

	test(`clear: adding source-backed values afterward uses fresh insertion order`, () => {
		const source = new Set([`a`, `b`])
		const o = new SetOverlay<string>(source)

		o.clear()
		o.add(`x`)
		o.add(`a`)

		expect(o.has(`a`)).toBe(true)
		expect(o.hasOwn(`a`)).toBe(true)
		expect(o.deleted).toEqual(new Set([`b`]))
		expect([...o]).toEqual([`x`, `a`])
		expect(o.size).toBe(2)
	})
})
