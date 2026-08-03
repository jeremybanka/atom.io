import type { Logger, TimelineEffect, WritableToken } from "atom.io"
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
	redoTransaction,
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
	undoTransaction,
} from "atom.io"
import { setTestLogLevel, stateExists, takeSnapshot } from "atom.io/testing"
import { UList } from "atom.io/transceivers/u-list"
import { vitest } from "vitest"

import * as Utils from "../__util__/index.ts"

let logger: Logger
const { restore } = takeSnapshot()

const cullUndoStepsOnRecord =
	(limit: number): TimelineEffect<any> =>
	({ cullUndoSteps, onRecord }) => {
		onRecord(() => {
			cullUndoSteps(limit)
		})
	}

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

		const abcTimeline = timeline({
			key: `abc`,
			scope: [aAtom, bAtom, cAtom],
		})

		const incrementABTransaction = transaction<() => void>({
			key: `incrementAB`,
			do: ({ set }) => {
				set(aAtom, (n) => n + 1)
				set(bAtom, (n) => n + 1)
			},
		})

		const incrementBCTransaction = transaction<(plus: number) => void>({
			key: `incrementBC`,
			do: ({ set }, add = 1) => {
				set(bAtom, (n) => n + add)
				set(cAtom, (n) => n + add)
			},
		})

		subscribe(abcTimeline, Utils.stdout0)

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

		runTransaction(incrementABTransaction)()
		const expectation2 = () => {
			expect(getState(aAtom)).toBe(2)
			expect(getState(bAtom)).toBe(1)
			expect(getState(cAtom)).toBe(0)
			expect(getState(product_abcSelector)).toBe(0)
		}
		expectation2()

		runTransaction(incrementBCTransaction)(2)
		const expectation3 = () => {
			expect(getState(aAtom)).toBe(2)
			expect(getState(bAtom)).toBe(3)
			expect(getState(cAtom)).toBe(2)
		}
		expectation3()

		undo(abcTimeline)
		expectation2()

		redo(abcTimeline)
		expectation3()

		undo(abcTimeline)
		undo(abcTimeline)
		expectation1()

		undo(abcTimeline)
		expectation0()

		expect(inspectTimeline(abcTimeline)).toEqual({ at: 0, length: 3 })
		expect(Utils.stdout0).toHaveBeenCalledTimes(8)
	})
	test(`time traveling with nested transactions`, () => {
		const aAtom = atom<number>({
			key: `a`,
			default: 0,
		})
		const incrementTransaction = transaction<
			(state: WritableToken<number>) => void
		>({
			key: `increment`,
			do: ({ set }, state) => {
				set(state, (n) => n + 1)
			},
		})

		const aTimeline = timeline({
			key: `a`,
			scope: [aAtom],
		})
		const incrementTimesTransaction = transaction<
			(state: WritableToken<number>, times: number) => void
		>({
			key: `incrementTimes`,
			do: ({ run }, state, times) => {
				for (let i = 0; i < times; ++i) {
					run(incrementTransaction)(state)
				}
			},
		})
		runTransaction(incrementTimesTransaction)(aAtom, 3)
		expect(getState(aAtom)).toBe(3)
		undo(aTimeline)
		expect(getState(aAtom)).toBe(0)
		redo(aTimeline)
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

		const numbersTimeline = timeline({
			key: `numbers`,
			scope: [aAtom, bAtom],
		})

		subscribe(aAtom, Utils.stdout)

		setState(product_abSelector, 1)

		undo(numbersTimeline)

		expect(getState(aAtom)).toBe(3)

		expect(Utils.stdout).toHaveBeenCalledWith({ oldValue: 3, newValue: 1 })
		expect(Utils.stdout).toHaveBeenCalledWith({ oldValue: 1, newValue: 3 })

		redo(numbersTimeline)

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

		const numbersTimeline = timeline({
			key: `numbers`,
			scope: [numberAtoms],
		})

		setState(productSquareRootSelectors, [`a`, `b`], 3)

		expect(inspectTimeline(numbersTimeline).length).toBe(1)
		undo(numbersTimeline)
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
		const setNameTransaction = transaction<(s: string) => void>({
			key: `setName`,
			do: ({ set }, name) => {
				set(nameCapitalizedSelector, name)
			},
		})

		const nameHistoryTimeline = timeline({
			key: `nameHistory`,
			scope: [nameAtom],
		})

		expect(getState(nameAtom)).toBe(`josie`)

		setState(nameAtom, `vance`)
		setState(nameCapitalizedSelector, `JON`)
		runTransaction(setNameTransaction)(`Sylvia`)

		expect(getState(nameAtom)).toBe(`sylvia`)
		expect(inspectTimeline(nameHistoryTimeline)).toEqual({ at: 3, length: 3 })

		undo(nameHistoryTimeline)
		expect(getState(nameAtom)).toBe(`jon`)
		expect(inspectTimeline(nameHistoryTimeline)).toEqual({ at: 2, length: 3 })

		undo(nameHistoryTimeline)
		expect(getState(nameAtom)).toBe(`vance`)
		expect(inspectTimeline(nameHistoryTimeline)).toEqual({ at: 1, length: 3 })

		undo(nameHistoryTimeline)
		expect(getState(nameAtom)).toBe(`josie`)
		expect(inspectTimeline(nameHistoryTimeline)).toEqual({ at: 0, length: 3 })

		runTransaction(setNameTransaction)(`Mr. Jason Gold`)

		expect(getState(nameAtom)).toBe(`mr. jason gold`)
		expect(inspectTimeline(nameHistoryTimeline)).toEqual({ at: 1, length: 1 })
	})
	it(`adds members of a family already created`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const myCountState = findState(countAtoms, `foo`)
		const countsTimeline = timeline({
			key: `counts`,
			scope: [countAtoms],
		})
		expect(getState(myCountState)).toBe(0)
		setState(myCountState, 1)
		expect(getState(myCountState)).toBe(1)
		undo(countsTimeline)
		expect(getState(myCountState)).toBe(0)
	})
	it(`passes over non-write events`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})

		const countTimeline = timeline({
			key: `count`,
			scope: [countAtoms],
		})

		setState(countAtoms, `a`, 1)
		getState(countAtoms, `b`)

		undo(countTimeline)
		expect(getState(countAtoms, `a`)).toBe(0)

		undo(countTimeline)

		setState(countAtoms, `a`, 1)
		getState(countAtoms, `b`)

		undo(countTimeline)
		redo(countTimeline)
		expect(getState(countAtoms, `a`)).toBe(1)
	})
	test(`history can be cleared explicitly`, () => {
		const letterAtom = atom<string>({
			key: `letter`,
			default: `A`,
		})
		const letterTimeline = timeline({
			key: `letter`,
			scope: [letterAtom],
		})

		setState(letterAtom, `B`)
		setState(letterAtom, `C`)

		expect(inspectTimeline(letterTimeline)).toEqual({ at: 2, length: 2 })

		clearTimeline(letterTimeline)

		expect(inspectTimeline(letterTimeline)).toEqual({ at: 0, length: 0 })

		setState(letterAtom, `D`)

		expect(inspectTimeline(letterTimeline)).toEqual({ at: 1, length: 1 })
		expect(getState(letterAtom)).toBe(`D`)
	})
	test(`mutable reference replacements can be undone and redone`, () => {
		const itemAtoms = mutableAtomFamily<UList<string>, string>({
			key: `item`,
			class: UList,
		})
		const items = findState(itemAtoms, `a`)
		getState(items)
		const itemHistoryTimeline = timeline({ key: `itemHistory`, scope: [items] })
		clearTimeline(itemHistoryTimeline)

		setState(items, new UList([`one`]))

		expect(getState(items)).toEqual(new UList([`one`]))
		expect(inspectTimeline(itemHistoryTimeline)).toEqual({ at: 1, length: 1 })

		undo(itemHistoryTimeline)
		expect(getState(items)).toEqual(new UList())
		expect(inspectTimeline(itemHistoryTimeline)).toEqual({ at: 0, length: 1 })

		redo(itemHistoryTimeline)
		expect(getState(items)).toEqual(new UList([`one`]))
		expect(inspectTimeline(itemHistoryTimeline)).toEqual({ at: 1, length: 1 })
	})
	test(`mutable inner signals are recorded exactly once`, () => {
		const itemAtoms = mutableAtomFamily<UList<string>, string>({
			key: `item`,
			class: UList,
		})
		const items = findState(itemAtoms, `a`)
		getState(items)
		const itemHistoryTimeline = timeline({ key: `itemHistory`, scope: [items] })
		clearTimeline(itemHistoryTimeline)

		setState(items, (current) => current.add(`one`))

		expect(getState(items)).toEqual(new UList([`one`]))
		expect(inspectTimeline(itemHistoryTimeline)).toEqual({ at: 1, length: 1 })

		undo(itemHistoryTimeline)
		expect(getState(items)).toEqual(new UList())
		expect(inspectTimeline(itemHistoryTimeline)).toEqual({ at: 0, length: 1 })

		redo(itemHistoryTimeline)
		expect(getState(items)).toEqual(new UList([`one`]))
		expect(inspectTimeline(itemHistoryTimeline)).toEqual({ at: 1, length: 1 })
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
		const itemHistoryTimeline = timeline({ key: `itemHistory`, scope: [items] })
		clearTimeline(itemHistoryTimeline)

		setState(latestItemSelector, `one`)

		expect(getState(items)).toEqual(new UList([`one`]))
		expect(inspectTimeline(itemHistoryTimeline)).toEqual({ at: 1, length: 1 })

		undo(itemHistoryTimeline)
		expect(getState(items)).toEqual(new UList())
		expect(inspectTimeline(itemHistoryTimeline)).toEqual({ at: 0, length: 1 })

		redo(itemHistoryTimeline)
		expect(getState(items)).toEqual(new UList([`one`]))
		expect(inspectTimeline(itemHistoryTimeline)).toEqual({ at: 1, length: 1 })
	})
})

describe(`timeline effects`, () => {
	test(`exposes records as deeply readonly`, () => {
		const documentAtom = atom<{
			metadata: { author: string }
			pages: string[]
		}>({
			key: `document`,
			default: { metadata: { author: `John Doe` }, pages: [] },
		})
		const readonlyRecordEffect: TimelineEffect<typeof documentAtom> = ({
			onRecord,
		}) => {
			onRecord((record) => {
				// @ts-expect-error Timeline record events are readonly.
				record.type = `timeline_record`
				if (record.event.type === `atom_update`) {
					// @ts-expect-error Nested record values are readonly.
					record.event.update.newValue.metadata.author = `Jane Doe`
					// @ts-expect-error Arrays nested in record values are readonly.
					record.event.update.newValue.pages.push(`cover`)
				}
			})
		}

		expect(readonlyRecordEffect).toBeTypeOf(`function`)
	})

	test(`retains exactly the latest 100 undo steps`, () => {
		const documentAtom = atom<number>({ key: `document`, default: 0 })
		const documentTimeline = timeline({
			key: `document`,
			scope: [documentAtom],
			effects: [cullUndoStepsOnRecord(100)],
		})

		for (let version = 1; version <= 105; version++) {
			setState(documentAtom, version)
		}

		expect(inspectTimeline(documentTimeline)).toEqual({ at: 100, length: 100 })
		for (let step = 0; step < 100; step++) {
			undo(documentTimeline)
		}
		expect(getState(documentAtom)).toBe(5)
		undo(documentTimeline)
		expect(getState(documentAtom)).toBe(5)
	})

	test(`uses the smallest limit requested by multiple effects`, () => {
		const countAtom = atom<number>({ key: `count`, default: 0 })
		const countTimeline = timeline({
			key: `count`,
			scope: [countAtom],
			effects: [cullUndoStepsOnRecord(2), cullUndoStepsOnRecord(1)],
		})

		setState(countAtom, 1)
		setState(countAtom, 2)
		expect(inspectTimeline(countTimeline)).toEqual({ at: 1, length: 1 })
		undo(countTimeline)
		expect(getState(countAtom)).toBe(1)
	})

	test(`truncates redo before eviction and publishes coherent metadata`, () => {
		const countAtom = atom<number>({ key: `count`, default: 0 })
		const countTimeline = timeline({
			key: `count`,
			scope: [countAtom],
			effects: [cullUndoStepsOnRecord(2)],
		})
		const updates: { at: number; length: number }[] = []
		subscribe(countTimeline, ({ at, length }) => updates.push({ at, length }))

		setState(countAtom, 1)
		setState(countAtom, 2)
		setState(countAtom, 3)
		expect(inspectTimeline(countTimeline)).toEqual({ at: 2, length: 2 })
		expect(updates.at(-1)).toEqual({ at: 2, length: 2 })

		undo(countTimeline)
		setState(countAtom, 4)
		expect(inspectTimeline(countTimeline)).toEqual({ at: 2, length: 2 })
		expect(updates.at(-1)).toEqual({ at: 2, length: 2 })
		undo(countTimeline)
		undo(countTimeline)
		expect(getState(countAtom)).toBe(1)

		clearTimeline(countTimeline)
		setState(countAtom, 5)
		setState(countAtom, 6)
		setState(countAtom, 7)
		expect(inspectTimeline(countTimeline)).toEqual({ at: 2, length: 2 })
	})

	test(`culls immediately outside recording and cleans up on disposal`, () => {
		const countAtom = atom<number>({ key: `count`, default: 0 })
		const cleanup = vitest.fn()
		let cullUndoSteps!: (limit: number) => void
		let cullAlternateHistories!: (limit: number) => void
		const countTimeline = timeline({
			key: `count`,
			scope: [countAtom],
			effects: [
				(tools) => {
					cullUndoSteps = tools.cullUndoSteps
					cullAlternateHistories = tools.cullAlternateHistories
					expect(tools.token).toEqual({ key: `count`, type: `timeline` })
					return cleanup
				},
			],
		})
		const updates = vitest.fn()
		subscribe(countTimeline, updates)

		setState(countAtom, 1)
		setState(countAtom, 2)
		setState(countAtom, 3)
		undo(countTimeline)
		cullUndoSteps(1)

		expect(getState(countAtom)).toBe(2)
		expect(inspectTimeline(countTimeline)).toEqual({ at: 1, length: 2 })
		expect(updates).toHaveBeenLastCalledWith({
			type: `timeline_update`,
			event: `cull`,
			at: 1,
			length: 2,
		})
		redo(countTimeline)
		expect(getState(countAtom)).toBe(3)

		cullAlternateHistories(0)
		expect(inspectTimeline(countTimeline)).toEqual({ at: 2, length: 2 })
		disposeTimeline(countTimeline)
		expect(cleanup).toHaveBeenCalledOnce()
	})

	test(`evicts selector and transaction checkpoints only as complete groups`, () => {
		const recordTypes: string[] = []
		const selectorSubEventCounts: number[] = []
		const aAtom = atom<number>({ key: `a`, default: 0 })
		const bAtom = atom<number>({ key: `b`, default: 0 })
		const pairSelector = selector<number>({
			key: `pair`,
			get: ({ get }) => get(aAtom),
			set: ({ set }, value) => {
				set(aAtom, value)
				set(bAtom, value)
			},
		})
		const setPairTransaction = transaction<(value: number) => void>({
			key: `setPair`,
			do: ({ set }, value) => {
				set(aAtom, value)
				set(bAtom, value)
			},
		})
		const incrementPairTransaction = transaction<() => void>({
			key: `incrementPair`,
			do: ({ set }) => {
				set(aAtom, (value) => value + 1)
				set(bAtom, (value) => value + 1)
			},
		})
		const incrementPairTwiceTransaction = transaction<() => void>({
			key: `incrementPairTwice`,
			do: ({ run }) => {
				run(incrementPairTransaction)()
				run(incrementPairTransaction)()
			},
		})
		const pairTimeline = timeline({
			key: `pair`,
			scope: [aAtom, bAtom],
			effects: [
				({ cullUndoSteps, onRecord }) => {
					onRecord(({ event }) => {
						recordTypes.push(event.type)
						if (event.type === `selector_update`) {
							selectorSubEventCounts.push(event.subEvents.length)
						}
						cullUndoSteps(2)
					})
				},
			],
		})

		setState(pairSelector, 1)
		runTransaction(setPairTransaction)(2)
		runTransaction(incrementPairTwiceTransaction)()

		expect(getState(aAtom)).toBe(4)
		expect(getState(bAtom)).toBe(4)
		expect(recordTypes).toEqual([
			`selector_update`,
			`transaction_outcome`,
			`transaction_outcome`,
		])
		expect(selectorSubEventCounts).toEqual([2])
		expect(inspectTimeline(pairTimeline)).toEqual({ at: 2, length: 2 })
		undo(pairTimeline)
		expect(getState(aAtom)).toBe(2)
		expect(getState(bAtom)).toBe(2)
		undo(pairTimeline)
		expect(getState(aAtom)).toBe(1)
		expect(getState(bAtom)).toBe(1)
		undo(pairTimeline)
		expect(getState(aAtom)).toBe(1)
		expect(getState(bAtom)).toBe(1)
	})

	test(`measures checkpoint groups instead of raw lifecycle events`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countA = findState(countAtoms, `a`)
		const countB = findState(countAtoms, `b`)
		getState(countA)
		getState(countB)
		const countHistoryTimeline = timeline({
			key: `countHistory`,
			scope: [countAtoms],
			effects: [cullUndoStepsOnRecord(1)],
		})

		setState(countA, 1)
		disposeState(countA)
		setState(countB, 1)

		expect(inspectTimeline(countHistoryTimeline)).toEqual({ at: 1, length: 1 })
		undo(countHistoryTimeline)
		expect(getState(countB)).toBe(0)
		expect(stateExists(countA)).toBe(false)
		undo(countHistoryTimeline)
		expect(stateExists(countA)).toBe(false)
	})

	test(`enforces effects independently for timeline-family members`, () => {
		const createdEffects: string[] = []
		const cleanedEffects: string[] = []
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countHistoryTimelines = timelineFamily<string>({
			key: `countHistory`,
			scope: [scopeFamily(countAtoms, { timelineKey: (key) => key })],
			effects: (key) => {
				createdEffects.push(key)
				return [
					({ cullUndoSteps, onRecord }) => {
						onRecord(() => {
							cullUndoSteps(2)
						})
						return () => {
							cleanedEffects.push(key)
						}
					},
				]
			},
		})
		const historyA = findTimeline(countHistoryTimelines, `a`)
		const historyB = findTimeline(countHistoryTimelines, `b`)
		expect(createdEffects).toEqual([`a`, `b`])
		getState(countAtoms, `a`)
		getState(countAtoms, `b`)
		clearTimeline(historyA)
		clearTimeline(historyB)

		setState(countAtoms, `a`, 1)
		setState(countAtoms, `a`, 2)
		setState(countAtoms, `a`, 3)
		setState(countAtoms, `b`, 1)

		expect(inspectTimeline(historyA)).toEqual({ at: 2, length: 2 })
		expect(inspectTimeline(historyB)).toEqual({ at: 1, length: 1 })
		undo(historyA)
		undo(historyA)
		expect(getState(countAtoms, `a`)).toBe(1)
		undo(historyB)
		expect(getState(countAtoms, `b`)).toBe(0)

		disposeTimeline(countHistoryTimelines, `a`)
		expect(cleanedEffects).toEqual([`a`])
		const recreatedHistoryA = findTimeline(countHistoryTimelines, `a`)
		expect(createdEffects).toEqual([`a`, `b`, `a`])
		setState(countAtoms, `a`, 4)
		setState(countAtoms, `a`, 5)
		setState(countAtoms, `a`, 6)
		expect(inspectTimeline(recreatedHistoryA)).toEqual({ at: 2, length: 2 })
		undo(recreatedHistoryA)
		undo(recreatedHistoryA)
		expect(getState(countAtoms, `a`)).toBe(4)
	})

	test(`keeps cross-timeline transaction controls coherent after eviction`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countHistoryTimelines = timelineFamily<string>({
			key: `countHistory`,
			scope: [scopeFamily(countAtoms, { timelineKey: (key) => key })],
			effects: () => [cullUndoStepsOnRecord(1)],
		})
		const historyA = findTimeline(countHistoryTimelines, `a`)
		const historyB = findTimeline(countHistoryTimelines, `b`)
		getState(countAtoms, `a`)
		getState(countAtoms, `b`)
		clearTimeline(historyA)
		clearTimeline(historyB)
		const setBothTransaction = transaction<() => void>({
			key: `setBoth`,
			do: ({ set }) => {
				set(countAtoms, `a`, 1)
				set(countAtoms, `b`, 1)
			},
		})

		runTransaction(setBothTransaction)()
		setState(countAtoms, `a`, 2)
		undoTransaction(setBothTransaction)

		expect(getState(countAtoms, `a`)).toBe(2)
		expect(getState(countAtoms, `b`)).toBe(0)
		expect(inspectTimeline(historyA)).toEqual({ at: 1, length: 1 })
		expect(inspectTimeline(historyB)).toEqual({ at: 0, length: 1 })
		redoTransaction(setBothTransaction)
		expect(getState(countAtoms, `a`)).toBe(2)
		expect(getState(countAtoms, `b`)).toBe(1)
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
		const itemHistoryTimeline = timeline({
			key: `itemHistory`,
			scope: [itemAtoms],
		})
		clearTimeline(itemHistoryTimeline)

		disposeState(itemAtoms, `a`)
		expect(stateExists(itemAtoms, `a`)).toBe(false)

		undo(itemHistoryTimeline)
		expect(stateExists(itemAtoms, `a`)).toBe(true)

		setState(items, (current) => current.add(`one`))
		expect(getState(items)).toEqual(new UList([`one`]))
		expect(inspectTimeline(itemHistoryTimeline)).toEqual({ at: 1, length: 1 })
	})
	test(`member-scoped timelines survive update-then-dispose transactions`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countA = findState(countAtoms, `a`)
		getState(countA)
		const countHistoryTimeline = timeline({
			key: `countHistory`,
			scope: [countA],
		})
		clearTimeline(countHistoryTimeline)
		const updateAndRemoveCountTransaction = transaction<() => void>({
			key: `updateAndRemoveCount`,
			do: ({ dispose, set }) => {
				set(countA, 1)
				dispose(countA)
			},
		})

		expect(() => {
			runTransaction(updateAndRemoveCountTransaction)()
		}).not.toThrow()
		expect(stateExists(countAtoms, `a`)).toBe(false)

		undo(countHistoryTimeline)
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
		const countHistoryTimeline = timeline({
			key: `countHistory`,
			scope: [countA, countB],
		})
		const removeAAndUpdateBTransaction = transaction<() => void>({
			key: `removeAAndUpdateB`,
			do: ({ dispose, set }) => {
				dispose(countA)
				set(countB, 1)
			},
		})

		runTransaction(removeAAndUpdateBTransaction)()
		expect(stateExists(countAtoms, `a`)).toBe(false)
		expect(getState(countB)).toBe(1)

		undo(countHistoryTimeline)
		expect(stateExists(countAtoms, `a`)).toBe(true)
		expect(getState(countA)).toBe(0)
		expect(getState(countB)).toBe(0)
	})

	test(`states may be disposed via undo/redo`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countsTimeline = timeline({
			key: `counts`,
			scope: [countAtoms],
		})
		setState(countAtoms, `my-key`, 1)
		expect(getState(countAtoms, `my-key`)).toBe(1)
		disposeState(countAtoms, `my-key`)
		undo(countsTimeline)

		expect(stateExists(countAtoms, `my-key`)).toBe(false)
		redo(countsTimeline)
		expect(stateExists(countAtoms, `my-key`)).toBe(true)
	})

	test(`ordinary timelines may be disposed and recreated`, () => {
		const countAtom = atom<number>({ key: `count`, default: 0 })
		let countHistoryTimeline = timeline({
			key: `countHistory`,
			scope: [countAtom],
		})
		const onUpdate = vitest.fn()
		const unsubscribe = subscribe(countHistoryTimeline, onUpdate)

		setState(countAtom, 1)
		disposeTimeline(countHistoryTimeline)
		expect(() => inspectTimeline(countHistoryTimeline)).toThrow()
		setState(countAtom, 2)
		expect(onUpdate).toHaveBeenCalledTimes(1)
		unsubscribe()

		countHistoryTimeline = timeline({
			key: `countHistory`,
			scope: [countAtom],
		})
		expect(inspectTimeline(countHistoryTimeline)).toEqual({ at: 0, length: 0 })
		setState(countAtom, 3)
		expect(inspectTimeline(countHistoryTimeline)).toEqual({ at: 1, length: 1 })
	})
})

describe(`timeline families`, () => {
	test(`coordinates transaction undo across timeline members`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countHistoryTimelines = timelineFamily<string>({
			key: `countHistory`,
			scope: [scopeFamily(countAtoms, { timelineKey: (key) => key })],
		})
		const historyA = findTimeline(countHistoryTimelines, `a`)
		const historyB = findTimeline(countHistoryTimelines, `b`)
		getState(countAtoms, `a`)
		getState(countAtoms, `b`)
		clearTimeline(historyA)
		clearTimeline(historyB)
		const setBothCountsTransaction = transaction<(value: number) => void>({
			key: `setBothCounts`,
			do: ({ set }, value) => {
				set(countAtoms, `a`, value)
				set(countAtoms, `b`, value)
			},
		})

		runTransaction(setBothCountsTransaction, `first`)(1)
		runTransaction(setBothCountsTransaction, `second`)(2)
		undoTransaction(setBothCountsTransaction)
		expect(getState(countAtoms, `a`)).toBe(1)
		expect(getState(countAtoms, `b`)).toBe(1)
		expect(inspectTimeline(historyA)).toEqual({ at: 1, length: 2 })
		expect(inspectTimeline(historyB)).toEqual({ at: 1, length: 2 })

		undoTransaction(setBothCountsTransaction, `first`)
		expect(getState(countAtoms, `a`)).toBe(0)
		expect(getState(countAtoms, `b`)).toBe(0)
		expect(inspectTimeline(historyA)).toEqual({ at: 0, length: 2 })
		expect(inspectTimeline(historyB)).toEqual({ at: 0, length: 2 })

		runTransaction(setBothCountsTransaction, `diverged`)(3)
		setState(countAtoms, `a`, 4)
		undoTransaction(setBothCountsTransaction, `diverged`)
		expect(getState(countAtoms, `a`)).toBe(4)
		expect(getState(countAtoms, `b`)).toBe(0)
		expect(inspectTimeline(historyA)).toEqual({ at: 2, length: 2 })
		expect(inspectTimeline(historyB)).toEqual({ at: 0, length: 1 })
		expect(logger.error).not.toHaveBeenCalled()

		redoTransaction(setBothCountsTransaction, `diverged`)
		expect(getState(countAtoms, `a`)).toBe(4)
		expect(getState(countAtoms, `b`)).toBe(3)
		expect(inspectTimeline(historyA)).toEqual({ at: 2, length: 2 })
		expect(inspectTimeline(historyB)).toEqual({ at: 1, length: 1 })
	})

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

		const glyphHistoryTimelines = timelineFamily<string>({
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
		expect(glyphHistoryTimelines).toEqual({
			key: `glyphHistory`,
			type: `timeline_family`,
		})
		expect(JSON.parse(JSON.stringify(glyphHistoryTimelines))).toEqual(
			glyphHistoryTimelines,
		)
		const historyA = findTimeline(glyphHistoryTimelines, `a`)
		const historyB = findTimeline(glyphHistoryTimelines, `b`)

		expect(historyA).toEqual({
			key: `glyphHistory("a")`,
			type: `timeline`,
			family: { key: `glyphHistory`, subKey: `"a"` },
		})
		expect(findTimeline(glyphHistoryTimelines, `a`)).toEqual(historyA)

		clearTimeline(glyphHistoryTimelines, `a`)
		clearTimeline(glyphHistoryTimelines, `b`)
		getState(pointAtoms, [`a`, `future`])
		getState(coordinateAtoms, [`regular`, `b`, `future`])
		getState(pointAtoms, [`excluded`, `future`])
		clearTimeline(glyphHistoryTimelines, `a`)
		clearTimeline(glyphHistoryTimelines, `b`)
		setState(pointAtoms, [`a`, `future`], 5)
		setState(coordinateAtoms, [`regular`, `b`, `future`], 7)
		setState(pointAtoms, [`excluded`, `future`], 9)

		expect(inspectTimeline(glyphHistoryTimelines, `a`).length).toBeGreaterThan(0)
		expect(inspectTimeline(glyphHistoryTimelines, `b`).length).toBeGreaterThan(0)
		expect(inspectTimeline(historyA)).toEqual(
			inspectTimeline(glyphHistoryTimelines, `a`),
		)

		undo(glyphHistoryTimelines, `a`)
		expect(getState(pointAtoms, [`a`, `future`])).toBe(0)
		expect(getState(coordinateAtoms, [`regular`, `b`, `future`])).toBe(7)
		redo(glyphHistoryTimelines, `a`)
		expect(getState(pointAtoms, [`a`, `future`])).toBe(5)
		expect(getState(pointAtoms, [`excluded`, `future`])).toBe(9)

		clearTimeline(historyA)
		clearTimeline(historyB)
		const editBothGlyphsTransaction = transaction<() => void>({
			key: `editBothGlyphs`,
			do: ({ set }) => {
				set(pointAtoms, [`a`, `future`], 6)
				set(coordinateAtoms, [`regular`, `b`, `future`], 8)
			},
		})
		runTransaction(editBothGlyphsTransaction)()
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
		const countHistoryTimelines = timelineFamily<string>({
			key: `countHistory`,
			scope: [scopeFamily(countAtoms, { timelineKey: (countKey) => countKey })],
		})
		const countHistory = findTimeline(countHistoryTimelines, `a`)
		const onUpdate = vitest.fn()
		const unsubscribe = subscribe(countHistoryTimelines, `a`, onUpdate)

		setState(countAtoms, `a`, 1)
		expect(onUpdate).toHaveBeenCalled()
		disposeTimeline(countHistoryTimelines, `a`)
		expect(() => inspectTimeline(countHistory)).toThrow()

		setState(countAtoms, `a`, 2)
		expect(onUpdate).toHaveBeenCalledTimes(1)
		unsubscribe()

		const recreated = findTimeline(countHistoryTimelines, `a`)
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
		const itemHistoryTimelines = timelineFamily<string>({
			key: `itemHistory`,
			scope: [scopeFamily(itemAtoms, { timelineKey: (itemKey) => itemKey })],
		})
		const history = findTimeline(itemHistoryTimelines, `a`)
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
		const countHistoryTimelines = timelineFamily<string>({
			key: `countHistory`,
			scope: [scopeFamily(countAtoms, { timelineKey: (countKey) => countKey })],
		})
		const committedHistory = findTimeline(countHistoryTimelines, `committed`)
		const abortedHistory = findTimeline(countHistoryTimelines, `aborted`)
		const createCountTransaction = transaction<
			(key: string, abort?: boolean) => void
		>({
			key: `createCount`,
			do: ({ set }, key, abort) => {
				set(countAtoms, key, 1)
				if (abort) {
					throw new Error(`abort`)
				}
			},
		})

		expect(() => {
			runTransaction(createCountTransaction)(`aborted`, true)
		}).toThrow(`abort`)
		runTransaction(createCountTransaction)(`committed`)

		expect(inspectTimeline(abortedHistory)).toEqual({ at: 0, length: 0 })
		expect(inspectTimeline(committedHistory)).toEqual({ at: 1, length: 1 })
		setState(countAtoms, `committed`, 2)
		expect(inspectTimeline(committedHistory)).toEqual({ at: 2, length: 2 })
	})
})

describe(`errors`, () => {
	test(`culling requires a non-negative safe integer`, () => {
		const countAtom = atom<number>({ key: `count`, default: 0 })
		expect(() =>
			timeline({
				key: `count`,
				scope: [countAtom],
				effects: [
					({ cullUndoSteps }) => {
						cullUndoSteps(-1)
					},
				],
			}),
		).toThrow(`A timeline cull limit must be a non-negative safe integer.`)
	})
	test(`what if the timeline isn't initialized`, () => {
		undo({ key: `my-timeline`, type: `timeline` })
		expect(logger.error).toHaveBeenCalledTimes(1)
	})
	test(`what if the atom family already belongs to a timeline`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})

		const _countTimeline = timeline({
			key: `_count`,
			scope: [countAtoms],
		})

		const countTimeline = timeline({
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
		const countTimeline = timeline({
			key: `count`,
			scope: [countAtoms],
		})
		setState(countAtoms, `foo`, 1)
		undo(countTimeline)
		expect(getState(countAtoms, `foo`)).toBe(0)
	})
})
