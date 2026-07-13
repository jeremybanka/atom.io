import type { Logger, WritableToken } from "atom.io"
import {
	atom,
	atomFamily,
	clearTimeline,
	disposeState,
	disposeTimeline,
	findState,
	findTimeline,
	getState,
	inspectTimeline,
	mutableAtomFamily,
	redo,
	runTransaction,
	scopeFamily,
	selector,
	selectorFamily,
	setState,
	subscribe,
	timeline,
	timelineFamily,
	transaction,
	undo,
} from "atom.io"
import { setTestLogLevel, stateExists, takeSnapshot } from "atom.io/testing"
import { UList } from "atom.io/transceivers/u-list"
import { vitest } from "vitest"

import * as Utils from "../__util__/index.ts"

let logger: Logger
const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	logger = setTestLogLevel(null)
	vitest.spyOn(logger, `error`)
	vitest.spyOn(logger, `warn`)
	vitest.spyOn(logger, `info`)
	vitest.spyOn(Utils, `stdout`)
	vitest.spyOn(Utils, `stdout0`)
})

describe(`timeline`, () => {
	it(`tracks the state of all atoms in its scope`, () => {
		const aAtom = atom<number>({
			key: `a`,
			default: 5,
		})
		const bAtom = atom<number>({
			key: `b`,
			default: 0,
		})
		const cAtom = atom<number>({
			key: `c`,
			default: 0,
		})

		const product_abcSelector = selector<number>({
			key: `product_abc`,
			get: ({ get }) => {
				return get(aAtom) * get(bAtom) * get(cAtom)
			},
		})

		const tl_abc = timeline({
			key: `a, b, & c`,
			scope: [aAtom, bAtom, cAtom],
		})

		const tx_ab = transaction<() => void>({
			key: `increment a & b`,
			do: ({ set }) => {
				set(aAtom, (n) => n + 1)
				set(bAtom, (n) => n + 1)
			},
		})

		const tx_bc = transaction<(plus: number) => void>({
			key: `increment b & c`,
			do: ({ set }, add = 1) => {
				set(bAtom, (n) => n + add)
				set(cAtom, (n) => n + add)
			},
		})

		subscribe(tl_abc, Utils.stdout0)

		const expectation0 = () => {
			expect(getState(aAtom)).toBe(5)
			expect(getState(bAtom)).toBe(0)
			expect(getState(cAtom)).toBe(0)
			expect(getState(product_abcSelector)).toBe(0)
		}
		expectation0()

		setState(aAtom, 1)
		const expectation1 = () => {
			expect(getState(aAtom)).toBe(1)
			expect(getState(bAtom)).toBe(0)
			expect(getState(cAtom)).toBe(0)
			expect(getState(product_abcSelector)).toBe(0)
		}
		expectation1()

		runTransaction(tx_ab)()
		const expectation2 = () => {
			expect(getState(aAtom)).toBe(2)
			expect(getState(bAtom)).toBe(1)
			expect(getState(cAtom)).toBe(0)
			expect(getState(product_abcSelector)).toBe(0)
		}
		expectation2()

		runTransaction(tx_bc)(2)
		const expectation3 = () => {
			expect(getState(aAtom)).toBe(2)
			expect(getState(bAtom)).toBe(3)
			expect(getState(cAtom)).toBe(2)
		}
		expectation3()

		undo(tl_abc)
		expectation2()

		redo(tl_abc)
		expectation3()

		undo(tl_abc)
		undo(tl_abc)
		expectation1()

		undo(tl_abc)
		expectation0()

		expect(inspectTimeline(tl_abc)).toEqual({ at: 0, length: 3 })
		expect(Utils.stdout0).toHaveBeenCalledTimes(8)
	})
	test(`time traveling with nested transactions`, () => {
		const aAtom = atom<number>({
			key: `a`,
			default: 0,
		})
		const incrementTX = transaction<(state: WritableToken<number>) => void>({
			key: `increment`,
			do: ({ set }, state) => {
				set(state, (n) => n + 1)
			},
		})

		const aTL = timeline({
			key: `a`,
			scope: [aAtom],
		})
		const incrementTimesTX = transaction<
			(state: WritableToken<number>, times: number) => void
		>({
			key: `increment times`,
			do: ({ run }, state, times) => {
				for (let i = 0; i < times; ++i) {
					run(incrementTX)(state)
				}
			},
		})
		runTransaction(incrementTimesTX)(aAtom, 3)
		expect(getState(aAtom)).toBe(3)
		undo(aTL)
		expect(getState(aAtom)).toBe(0)
		redo(aTL)
		expect(getState(aAtom)).toBe(3)
	})
	test(`subscriptions when time-traveling`, () => {
		const aAtom = atom<number>({
			key: `a`,
			default: 3,
		})
		const bAtom = atom<number>({
			key: `b`,
			default: 6,
		})

		const product_abSelector = selector<number>({
			key: `product_ab`,
			get: ({ get }) => {
				return get(aAtom) * get(bAtom)
			},
			set: ({ set }, value) => {
				set(aAtom, Math.sqrt(value))
				set(bAtom, Math.sqrt(value))
			},
		})

		const timeline_ab = timeline({
			key: `a & b`,
			scope: [aAtom, bAtom],
		})

		subscribe(aAtom, Utils.stdout)

		setState(product_abSelector, 1)

		undo(timeline_ab)

		expect(getState(aAtom)).toBe(3)

		expect(Utils.stdout).toHaveBeenCalledWith({ oldValue: 3, newValue: 1 })
		expect(Utils.stdout).toHaveBeenCalledWith({ oldValue: 1, newValue: 3 })

		redo(timeline_ab)

		expect(getState(aAtom)).toBe(1)
		expect(getState(bAtom)).toBe(1)
	})
	test(`creating selectors with setState`, () => {
		const numberAtoms = atomFamily<number, string>({
			key: `number`,
			default: 0,
		})

		const productSelectors = selectorFamily<number, [a: string, b: string]>({
			key: `product`,
			get:
				([a, b]) =>
				({ get }) =>
					get(numberAtoms, a) * get(numberAtoms, b),
			set:
				([a, b]) =>
				({ set }, value) => {
					set(numberAtoms, a, Math.sqrt(value))
					set(numberAtoms, b, Math.sqrt(value))
				},
		})

		const productSquareRootSelectors = selectorFamily<
			number,
			[a: string, b: string]
		>({
			key: `productSquareRoot`,
			get:
				(key) =>
				({ get }) =>
					Math.sqrt(get(productSelectors, key)),
			set:
				(key) =>
				({ set }, value) => {
					set(productSelectors, key, value ** 2)
				},
		})

		const timeline_ab = timeline({
			key: `numbers over time`,
			scope: [numberAtoms],
		})

		setState(productSquareRootSelectors, [`a`, `b`], 3)

		expect(inspectTimeline(timeline_ab).length).toBe(1)
		undo(timeline_ab)
	})
	test(`history erasure from the past`, () => {
		const nameAtom = atom<string>({
			key: `name`,
			default: `josie`,
		})
		const nameCapitalizedSelector = selector<string>({
			key: `nameCapitalized`,
			get: ({ get }) => {
				return get(nameAtom).toUpperCase()
			},
			set: ({ set }, value) => {
				set(nameAtom, value.toLowerCase())
			},
		})
		const setName = transaction<(s: string) => void>({
			key: `set name`,
			do: ({ set }, name) => {
				set(nameCapitalizedSelector, name)
			},
		})

		const nameHistory = timeline({
			key: `name history`,
			scope: [nameAtom],
		})

		expect(getState(nameAtom)).toBe(`josie`)

		setState(nameAtom, `vance`)
		setState(nameCapitalizedSelector, `JON`)
		runTransaction(setName)(`Sylvia`)

		expect(getState(nameAtom)).toBe(`sylvia`)
		expect(inspectTimeline(nameHistory)).toEqual({ at: 3, length: 3 })

		undo(nameHistory)
		expect(getState(nameAtom)).toBe(`jon`)
		expect(inspectTimeline(nameHistory)).toEqual({ at: 2, length: 3 })

		undo(nameHistory)
		expect(getState(nameAtom)).toBe(`vance`)
		expect(inspectTimeline(nameHistory)).toEqual({ at: 1, length: 3 })

		undo(nameHistory)
		expect(getState(nameAtom)).toBe(`josie`)
		expect(inspectTimeline(nameHistory)).toEqual({ at: 0, length: 3 })

		runTransaction(setName)(`Mr. Jason Gold`)

		expect(getState(nameAtom)).toBe(`mr. jason gold`)
		expect(inspectTimeline(nameHistory)).toEqual({ at: 1, length: 1 })
	})
	it(`adds members of a family already created`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const myCountState = findState(countAtoms, `foo`)
		const countsTL = timeline({
			key: `counts`,
			scope: [countAtoms],
		})
		expect(getState(myCountState)).toBe(0)
		setState(myCountState, 1)
		expect(getState(myCountState)).toBe(1)
		undo(countsTL)
		expect(getState(myCountState)).toBe(0)
	})
	it(`passes over non-write events`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})

		const countTL = timeline({
			key: `count`,
			scope: [countAtoms],
		})

		setState(countAtoms, `a`, 1)
		getState(countAtoms, `b`)

		undo(countTL)
		expect(getState(countAtoms, `a`)).toBe(0)

		undo(countTL)

		setState(countAtoms, `a`, 1)
		getState(countAtoms, `b`)

		undo(countTL)
		redo(countTL)
		expect(getState(countAtoms, `a`)).toBe(1)
	})
	test(`history can be cleared explicitly`, () => {
		const letterAtom = atom<string>({
			key: `letter`,
			default: `A`,
		})
		const letterTL = timeline({
			key: `letter-history`,
			scope: [letterAtom],
		})

		setState(letterAtom, `B`)
		setState(letterAtom, `C`)

		expect(inspectTimeline(letterTL)).toEqual({ at: 2, length: 2 })

		clearTimeline(letterTL)

		expect(inspectTimeline(letterTL)).toEqual({ at: 0, length: 0 })

		setState(letterAtom, `D`)

		expect(inspectTimeline(letterTL)).toEqual({ at: 1, length: 1 })
		expect(getState(letterAtom)).toBe(`D`)
	})
	test(`mutable reference replacements can be undone and redone`, () => {
		const itemAtoms = mutableAtomFamily<UList<string>, string>({
			key: `item`,
			class: UList,
		})
		const items = findState(itemAtoms, `a`)
		getState(items)
		const history = timeline({ key: `itemHistory`, scope: [items] })
		clearTimeline(history)

		setState(items, new UList([`one`]))

		expect(getState(items)).toEqual(new UList([`one`]))
		expect(inspectTimeline(history)).toEqual({ at: 1, length: 1 })

		undo(history)
		expect(getState(items)).toEqual(new UList())
		expect(inspectTimeline(history)).toEqual({ at: 0, length: 1 })

		redo(history)
		expect(getState(items)).toEqual(new UList([`one`]))
		expect(inspectTimeline(history)).toEqual({ at: 1, length: 1 })
	})
	test(`mutable inner signals are recorded exactly once`, () => {
		const itemAtoms = mutableAtomFamily<UList<string>, string>({
			key: `item`,
			class: UList,
		})
		const items = findState(itemAtoms, `a`)
		getState(items)
		const history = timeline({ key: `itemHistory`, scope: [items] })
		clearTimeline(history)

		setState(items, (current) => current.add(`one`))

		expect(getState(items)).toEqual(new UList([`one`]))
		expect(inspectTimeline(history)).toEqual({ at: 1, length: 1 })

		undo(history)
		expect(getState(items)).toEqual(new UList())
		expect(inspectTimeline(history)).toEqual({ at: 0, length: 1 })

		redo(history)
		expect(getState(items)).toEqual(new UList([`one`]))
		expect(inspectTimeline(history)).toEqual({ at: 1, length: 1 })
	})
	test(`mutable inner signals from selectors can be undone and redone`, () => {
		const itemAtoms = mutableAtomFamily<UList<string>, string>({
			key: `item`,
			class: UList,
		})
		const items = findState(itemAtoms, `a`)
		const latestItemSelector = selector<string>({
			key: `latestItem`,
			get: ({ get }) => [...get(items)].at(-1) ?? ``,
			set: ({ set }, item) => {
				set(items, (current) => current.add(item))
			},
		})
		const history = timeline({ key: `itemHistory`, scope: [items] })
		clearTimeline(history)

		setState(latestItemSelector, `one`)

		expect(getState(items)).toEqual(new UList([`one`]))
		expect(inspectTimeline(history)).toEqual({ at: 1, length: 1 })

		undo(history)
		expect(getState(items)).toEqual(new UList())
		expect(inspectTimeline(history)).toEqual({ at: 0, length: 1 })

		redo(history)
		expect(getState(items)).toEqual(new UList([`one`]))
		expect(inspectTimeline(history)).toEqual({ at: 1, length: 1 })
	})
})

describe(`timeline state lifecycle`, () => {
	test(`mutable members resubscribe after disposal is undone`, () => {
		const itemAtoms = mutableAtomFamily<UList<string>, string>({
			key: `item`,
			class: UList,
		})
		const items = findState(itemAtoms, `a`)
		getState(items)
		const history = timeline({ key: `itemHistory`, scope: [itemAtoms] })
		clearTimeline(history)

		disposeState(itemAtoms, `a`)
		expect(stateExists(itemAtoms, `a`)).toBe(false)

		undo(history)
		expect(stateExists(itemAtoms, `a`)).toBe(true)

		setState(items, (current) => current.add(`one`))
		expect(getState(items)).toEqual(new UList([`one`]))
		expect(inspectTimeline(history)).toEqual({ at: 1, length: 1 })
	})
	test(`member-scoped timelines survive update-then-dispose transactions`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countA = findState(countAtoms, `a`)
		getState(countA)
		const history = timeline({ key: `countHistory`, scope: [countA] })
		clearTimeline(history)
		const updateAndRemoveCount = transaction<() => void>({
			key: `updateAndRemoveCount`,
			do: ({ dispose, set }) => {
				set(countA, 1)
				dispose(countA)
			},
		})

		expect(() => {
			runTransaction(updateAndRemoveCount)()
		}).not.toThrow()
		expect(stateExists(countAtoms, `a`)).toBe(false)

		undo(history)
		expect(stateExists(countAtoms, `a`)).toBe(true)
		expect(getState(countA)).toBe(0)
	})
	test(`multi-topic timelines retain topics disposed before joining a transaction`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countA = findState(countAtoms, `a`)
		const countB = findState(countAtoms, `b`)
		getState(countA)
		getState(countB)
		const history = timeline({
			key: `countHistory`,
			scope: [countA, countB],
		})
		const removeAAndUpdateB = transaction<() => void>({
			key: `removeAAndUpdateB`,
			do: ({ dispose, set }) => {
				dispose(countA)
				set(countB, 1)
			},
		})

		runTransaction(removeAAndUpdateB)()
		expect(stateExists(countAtoms, `a`)).toBe(false)
		expect(getState(countB)).toBe(1)

		undo(history)
		expect(stateExists(countAtoms, `a`)).toBe(true)
		expect(getState(countA)).toBe(0)
		expect(getState(countB)).toBe(0)
	})

	test(`states may be disposed via undo/redo`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countsTL = timeline({
			key: `counts`,
			scope: [countAtoms],
		})
		setState(countAtoms, `my-key`, 1)
		expect(getState(countAtoms, `my-key`)).toBe(1)
		disposeState(countAtoms, `my-key`)
		undo(countsTL)

		expect(stateExists(countAtoms, `my-key`)).toBe(false)
		redo(countsTL)
		expect(stateExists(countAtoms, `my-key`)).toBe(true)
	})

	test(`ordinary timelines may be disposed and recreated`, () => {
		const countAtom = atom<number>({ key: `count`, default: 0 })
		const countHistory = timeline({
			key: `countHistory`,
			scope: [countAtom],
		})
		const onUpdate = vitest.fn()
		const unsubscribe = subscribe(countHistory, onUpdate)

		setState(countAtom, 1)
		disposeTimeline(countHistory)
		expect(() => inspectTimeline(countHistory)).toThrow()
		setState(countAtom, 2)
		expect(onUpdate).toHaveBeenCalledTimes(1)
		unsubscribe()

		const recreatedHistory = timeline({
			key: `countHistory`,
			scope: [countAtom],
		})
		expect(inspectTimeline(recreatedHistory)).toEqual({ at: 0, length: 0 })
		setState(countAtom, 3)
		expect(inspectTimeline(recreatedHistory)).toEqual({ at: 1, length: 1 })
	})
})

describe(`timeline families`, () => {
	test(`routes existing and future atom-family members by key`, () => {
		const glyphAtoms = atomFamily<number, string>({
			key: `glyph`,
			default: 0,
		})
		const pointAtoms = atomFamily<number, readonly [string, string]>({
			key: `point`,
			default: 0,
		})
		const coordinateAtoms = atomFamily<
			number,
			readonly [string, string, string]
		>({
			key: `coordinate`,
			default: 0,
		})
		const activePointXSelector = selector<number>({
			key: `activePointX`,
			get: ({ get }) => get(pointAtoms, [`a`, `future`]),
			set: ({ set }, value) => {
				set(pointAtoms, [`a`, `future`], value)
			},
		})

		setState(glyphAtoms, `a`, 1)
		setState(pointAtoms, [`a`, `existing`], 1)

		const glyphHistories = timelineFamily<string>({
			key: `glyphHistory`,
			scope: [
				scopeFamily(glyphAtoms, { timelineKey: (glyphId) => glyphId }),
				scopeFamily(pointAtoms, {
					timelineKey: ([glyphId]) =>
						glyphId === `excluded` ? undefined : glyphId,
				}),
				scopeFamily(coordinateAtoms, {
					timelineKey: ([, glyphId]) => glyphId,
				}),
			],
		})
		expect(glyphHistories).toEqual({
			key: `glyphHistory`,
			type: `timeline_family`,
		})
		expect(JSON.parse(JSON.stringify(glyphHistories))).toEqual(glyphHistories)
		const historyA = findTimeline(glyphHistories, `a`)
		const historyB = findTimeline(glyphHistories, `b`)

		expect(historyA).toEqual({
			key: `glyphHistory("a")`,
			type: `timeline`,
			family: { key: `glyphHistory`, subKey: `"a"` },
		})
		expect(findTimeline(glyphHistories, `a`)).toEqual(historyA)

		clearTimeline(glyphHistories, `a`)
		clearTimeline(glyphHistories, `b`)
		getState(pointAtoms, [`a`, `future`])
		getState(coordinateAtoms, [`regular`, `b`, `future`])
		getState(pointAtoms, [`excluded`, `future`])
		clearTimeline(glyphHistories, `a`)
		clearTimeline(glyphHistories, `b`)
		setState(pointAtoms, [`a`, `future`], 5)
		setState(coordinateAtoms, [`regular`, `b`, `future`], 7)
		setState(pointAtoms, [`excluded`, `future`], 9)

		expect(inspectTimeline(glyphHistories, `a`).length).toBeGreaterThan(0)
		expect(inspectTimeline(glyphHistories, `b`).length).toBeGreaterThan(0)
		expect(inspectTimeline(historyA)).toEqual(
			inspectTimeline(glyphHistories, `a`),
		)

		undo(glyphHistories, `a`)
		expect(getState(pointAtoms, [`a`, `future`])).toBe(0)
		expect(getState(coordinateAtoms, [`regular`, `b`, `future`])).toBe(7)
		redo(glyphHistories, `a`)
		expect(getState(pointAtoms, [`a`, `future`])).toBe(5)
		expect(getState(pointAtoms, [`excluded`, `future`])).toBe(9)

		clearTimeline(historyA)
		clearTimeline(historyB)
		const editBothGlyphs = transaction<() => void>({
			key: `editBothGlyphs`,
			do: ({ set }) => {
				set(pointAtoms, [`a`, `future`], 6)
				set(coordinateAtoms, [`regular`, `b`, `future`], 8)
			},
		})
		runTransaction(editBothGlyphs)()
		expect(inspectTimeline(historyA)).toEqual({ at: 1, length: 1 })
		expect(inspectTimeline(historyB)).toEqual({ at: 1, length: 1 })

		clearTimeline(historyA)
		clearTimeline(historyB)
		setState(activePointXSelector, 10)
		expect(inspectTimeline(historyA)).toEqual({ at: 1, length: 1 })
		expect(inspectTimeline(historyB)).toEqual({ at: 0, length: 0 })
		undo(historyA)
		expect(getState(pointAtoms, [`a`, `future`])).toBe(6)
	})

	test(`supports subscription, disposal, and fresh recreation`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countHistories = timelineFamily<string>({
			key: `countHistory`,
			scope: [scopeFamily(countAtoms, { timelineKey: (countKey) => countKey })],
		})
		const countHistory = findTimeline(countHistories, `a`)
		const onUpdate = vitest.fn()
		const unsubscribe = subscribe(countHistories, `a`, onUpdate)

		setState(countAtoms, `a`, 1)
		expect(onUpdate).toHaveBeenCalled()
		disposeTimeline(countHistories, `a`)
		expect(() => inspectTimeline(countHistory)).toThrow()

		setState(countAtoms, `a`, 2)
		expect(onUpdate).toHaveBeenCalledTimes(1)
		unsubscribe()

		const recreated = findTimeline(countHistories, `a`)
		expect(recreated).toEqual(countHistory)
		expect(inspectTimeline(recreated)).toEqual({ at: 0, length: 0 })
		setState(countAtoms, `a`, 3)
		expect(inspectTimeline(recreated)).toEqual({ at: 1, length: 1 })
	})

	test(`routes mutable atom-family members`, () => {
		const itemAtoms = mutableAtomFamily<UList<string>, string>({
			key: `item`,
			class: UList,
		})
		const itemHistories = timelineFamily<string>({
			key: `itemHistory`,
			scope: [scopeFamily(itemAtoms, { timelineKey: (itemKey) => itemKey })],
		})
		const history = findTimeline(itemHistories, `a`)
		const items = findState(itemAtoms, `a`)
		getState(items)
		clearTimeline(history)

		setState(items, (current) => current.add(`one`))
		expect(getState(items)).toEqual(new UList([`one`]))
		undo(history)
		expect(getState(items)).toEqual(new UList())
		redo(history)
		expect(getState(items)).toEqual(new UList([`one`]))

		disposeState(items)
		const recreatedItems = findState(itemAtoms, `a`)
		setState(recreatedItems, (current) => current.add(`recreated`))
		expect(inspectTimeline(history).at).toBeGreaterThan(0)
		undo(history)
		expect(getState(recreatedItems)).toEqual(new UList())
	})

	test(`indexes only atom-family members committed by transactions`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countHistories = timelineFamily<string>({
			key: `countHistory`,
			scope: [scopeFamily(countAtoms, { timelineKey: (countKey) => countKey })],
		})
		const committedHistory = findTimeline(countHistories, `committed`)
		const abortedHistory = findTimeline(countHistories, `aborted`)
		const createCount = transaction<(key: string, abort?: boolean) => void>({
			key: `createCount`,
			do: ({ set }, key, abort) => {
				set(countAtoms, key, 1)
				if (abort) {
					throw new Error(`abort`)
				}
			},
		})

		expect(() => {
			runTransaction(createCount)(`aborted`, true)
		}).toThrow(`abort`)
		runTransaction(createCount)(`committed`)

		expect(inspectTimeline(abortedHistory)).toEqual({ at: 0, length: 0 })
		expect(inspectTimeline(committedHistory)).toEqual({ at: 1, length: 1 })
		setState(countAtoms, `committed`, 2)
		expect(inspectTimeline(committedHistory)).toEqual({ at: 2, length: 2 })
	})
})

describe(`errors`, () => {
	test(`what if the timeline isn't initialized`, () => {
		undo({ key: `my-timeline`, type: `timeline` })
		expect(logger.error).toHaveBeenCalledTimes(1)
	})
	test(`what if the atom family already belongs to a timeline`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})

		const _countTL = timeline({
			key: `count`,
			scope: [countAtoms],
		})

		const _countTL2 = timeline({
			key: `count`,
			scope: [countAtoms],
		})

		expect(logger.error).toHaveBeenCalledTimes(1)
	})
	test(`timeline families reject duplicate scope descriptors`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})

		timelineFamily<string>({
			key: `countHistory`,
			scope: [
				scopeFamily(countAtoms, { timelineKey: (key) => key }),
				scopeFamily(countAtoms, { timelineKey: (key) => key }),
			],
		})

		expect(logger.error).toHaveBeenCalledTimes(1)
	})
	test(`timeline families reject atom families owned by ordinary timelines`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		timeline({ key: `ordinaryHistory`, scope: [countAtoms] })

		timelineFamily<string>({
			key: `countHistory`,
			scope: [scopeFamily(countAtoms, { timelineKey: (key) => key })],
		})

		expect(logger.error).toHaveBeenCalledTimes(1)
	})
	test(`ordinary timelines reject atom families owned by timeline families`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		timelineFamily<string>({
			key: `countHistory`,
			scope: [scopeFamily(countAtoms, { timelineKey: (key) => key })],
		})

		timeline({ key: `ordinaryHistory`, scope: [countAtoms] })

		expect(logger.error).toHaveBeenCalledTimes(1)
	})
	test(`timeline families reject atom families with an owned live member`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countA = findState(countAtoms, `a`)
		timeline({ key: `ordinaryHistory`, scope: [countA] })

		timelineFamily<string>({
			key: `countHistory`,
			scope: [scopeFamily(countAtoms, { timelineKey: (key) => key })],
		})

		expect(logger.error).toHaveBeenCalledTimes(1)
	})
})

describe(`weird situations`, () => {
	test(`what if states belonging to a family already exist, but then the family is given to a timeline`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		getState(countAtoms, `foo`)
		const countTL = timeline({
			key: `count`,
			scope: [countAtoms],
		})
		setState(countAtoms, `foo`, 1)
		undo(countTL)
		expect(getState(countAtoms, `foo`)).toBe(0)
	})
})
