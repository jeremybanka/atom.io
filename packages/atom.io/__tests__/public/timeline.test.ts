import type { Logger, WritableToken } from "atom.io"
import {
	atom,
	atomFamily,
	clearTimeline,
	disposeState,
	findState,
	getState,
	inspectTimeline,
	redo,
	runTransaction,
	selector,
	selectorFamily,
	setState,
	subscribe,
	timeline,
	transaction,
	undo,
} from "atom.io"
import { setTestLogLevel, stateExists, takeSnapshot } from "atom.io/testing"
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
})

describe(`timeline state lifecycle`, () => {
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
