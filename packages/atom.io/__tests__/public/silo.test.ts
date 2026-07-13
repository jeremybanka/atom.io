import type {
	MutableAtomFamilyOptions,
	MutableAtomFamilyToken,
	ReadonlyPureSelectorFamilyOptions,
	RegularAtomOptions,
} from "atom.io"
import { getState, scopeFamily, Silo } from "atom.io"
import { hasImplicitStoreBeenCreated } from "atom.io/testing"
import { UList } from "atom.io/transceivers/u-list"
import { u } from "motion/react-client"

import { createNullLogger } from "../__util__/nullLogger.ts"

afterEach(() => {
	globalThis.ATOM_IO_IMPLICIT_STORE = undefined
})

describe(`silo`, () => {
	it(`creates stores with independent states`, () => {
		const Uno = new Silo({
			name: `uno`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		const Dos = new Silo({
			name: `dos`,
			lifespan: `ephemeral`,
			isProduction: false,
		})

		const DEFAULT_COUNT_CONFIG: RegularAtomOptions<number> = {
			key: `count`,
			default: 0,
		}

		const UNO__countAtom = Uno.atom<number>(DEFAULT_COUNT_CONFIG)
		const DOS__countAtom = Dos.atom<number>(DEFAULT_COUNT_CONFIG)

		const UnoCountValue = Uno.getState(UNO__countAtom)
		const DosCountValue = Dos.getState(DOS__countAtom)

		expect(UnoCountValue).toBe(0)
		expect(DosCountValue).toBe(0)

		const subUno = vitest.fn()
		const subDos = vitest.fn()
		Uno.subscribe(UNO__countAtom, subUno)
		Dos.subscribe(DOS__countAtom, subDos)

		Uno.setState(UNO__countAtom, 1)
		Dos.setState(DOS__countAtom, 2)

		expect(Uno.getState(UNO__countAtom)).toBe(1)
		expect(Dos.getState(DOS__countAtom)).toBe(2)

		expect(subUno).toHaveBeenCalledWith({ newValue: 1, oldValue: 0 })
		expect(subDos).toHaveBeenCalledWith({ newValue: 2, oldValue: 0 })

		expect(hasImplicitStoreBeenCreated()).toBe(false)
		expect(() => getState(UNO__countAtom)).toThrow()
	})
	it(`creates mutable atoms, atom families, and transactions in its own store`, () => {
		const Uno = new Silo({
			name: `uno`,
			lifespan: `ephemeral`,
			isProduction: false,
		})

		const countsListAtom = Uno.mutableAtom<UList<string>>({
			key: `countsList`,
			class: UList,
		})
		const countAtoms = Uno.atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const createCounts = Uno.transaction<(upTo: number) => void>({
			key: `increment`,
			do: ({ set }, upTo) => {
				let numberToAdd = upTo
				while (numberToAdd) {
					const key = String(Math.random()).slice(2)
					set(countsListAtom, (ul) => {
						ul.add(key)
						return ul
					})
					numberToAdd--
					set(countAtoms, key, numberToAdd)
				}
			},
		})

		expect(Uno.getState(countsListAtom)).toEqual(new UList([]))
		Uno.runTransaction(createCounts)(3)
		const countsList = Uno.getState(countsListAtom)
		expect(countsList).toHaveLength(3)
		expect(hasImplicitStoreBeenCreated()).toBe(false)
	})
	it(`creates stores with independent state families`, () => {
		const Uno = new Silo({
			name: `uno`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		const Dos = new Silo({
			name: `dos`,
			lifespan: `ephemeral`,
			isProduction: false,
		})

		const DEFAULT_LIST_ATOMS_CONFIG: MutableAtomFamilyOptions<
			UList<number>,
			string
		> = {
			key: `counts`,
			class: UList,
		}
		const sizeSelectorsConfig = (
			listAtoms: MutableAtomFamilyToken<UList<number>, string>,
		): ReadonlyPureSelectorFamilyOptions<number, string> => ({
			key: `doubleCounts`,
			get:
				(key) =>
				({ get }) =>
					get(listAtoms, key).size,
		})

		const UNO__listAtoms = Uno.mutableAtomFamily<UList<number>, string>(
			DEFAULT_LIST_ATOMS_CONFIG,
		)
		const DOS__listAtoms = Dos.mutableAtomFamily<UList<number>, string>(
			DEFAULT_LIST_ATOMS_CONFIG,
		)
		const UNO__sizeSelectors = Uno.selectorFamily<number, string>(
			sizeSelectorsConfig(UNO__listAtoms),
		)
		const DOS__sizeSelectors = Dos.selectorFamily<number, string>(
			sizeSelectorsConfig(DOS__listAtoms),
		)

		const listState__Uno = Uno.findState(UNO__listAtoms, `a`)
		const listState__Dos = Dos.findState(DOS__listAtoms, `b`)

		const UnoCountValue = Uno.getState(listState__Uno)
		const DosCountValue = Dos.getState(listState__Dos)
		const UnoDoubleCountValue = Uno.getState(UNO__sizeSelectors, `a`)
		const DosDoubleCountValue = Dos.getState(DOS__sizeSelectors, `b`)

		expect(UnoCountValue).toEqual(new UList([]))
		expect(DosCountValue).toEqual(new UList([]))
		expect(UnoDoubleCountValue).toBe(0)
		expect(DosDoubleCountValue).toBe(0)

		Uno.setState(listState__Uno, (prev) => prev.add(1))
		Dos.setState(listState__Dos, (prev) => (prev.add(1), prev.add(2)))

		expect(Uno.getState(listState__Uno)).toEqual(new UList([1]))
		expect(Dos.getState(listState__Dos)).toEqual(new UList([1, 2]))
		expect(Uno.getState(UNO__sizeSelectors, `a`)).toBe(1)
		expect(Dos.getState(DOS__sizeSelectors, `b`)).toBe(2)

		Uno.resetState(listState__Uno)
		Dos.resetState(listState__Dos)

		expect(Uno.getState(listState__Uno)).toEqual(new UList([]))
		expect(Dos.getState(listState__Dos)).toEqual(new UList([]))
		expect(Uno.getState(UNO__sizeSelectors, `a`)).toBe(0)
		expect(Dos.getState(DOS__sizeSelectors, `b`)).toBe(0)

		Uno.disposeState(listState__Uno)
		Dos.disposeState(listState__Dos)

		expect(hasImplicitStoreBeenCreated()).toBe(false)
		expect(() => getState(listState__Uno)).toThrow()
	})
	it(`time-travels timelines in its own store`, () => {
		const Uno = new Silo({
			name: `uno`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		Uno.store.logger = createNullLogger()

		const countAtom = Uno.atom<number>({
			key: `count`,
			default: 0,
		})
		const countTimeline = Uno.timeline({
			key: `count`,
			scope: [countAtom],
		})

		Uno.setState(countAtom, 1)
		Uno.setState(countAtom, 2)

		Uno.undo(countTimeline)
		expect(Uno.getState(countAtom)).toBe(1)

		Uno.redo(countTimeline)
		expect(Uno.getState(countAtom)).toBe(2)

		Uno.clearTimeline(countTimeline)
		Uno.setState(countAtom, 3)
		Uno.undo(countTimeline)
		Uno.undo(countTimeline)
		expect(Uno.getState(countAtom)).toBe(2)

		expect(hasImplicitStoreBeenCreated()).toBe(false)
		expect(() => getState(countAtom)).toThrow()
	})
	it(`addresses timeline-family members in its own store`, () => {
		const Uno = new Silo({
			name: `uno-timeline-family`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		Uno.store.logger = createNullLogger()
		const countAtoms = Uno.atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countHistories = Uno.timelineFamily<string>({
			key: `countHistory`,
			scope: [scopeFamily(countAtoms, { timelineKey: (countKey) => countKey })],
		})
		const history = Uno.findTimeline(countHistories, `a`)
		const subscriber = vitest.fn()
		Uno.subscribe(countHistories, `a`, subscriber)

		Uno.getState(countAtoms, `a`)
		Uno.clearTimeline(countHistories, `a`)
		Uno.setState(countAtoms, `a`, 1)
		expect(Uno.inspectTimeline(countHistories, `a`)).toEqual({
			at: 1,
			length: 1,
		})
		expect(subscriber).toHaveBeenCalled()
		Uno.undo(countHistories, `a`)
		expect(Uno.getState(countAtoms, `a`)).toBe(0)
		Uno.redo(countHistories, `a`)
		expect(Uno.getState(countAtoms, `a`)).toBe(1)

		Uno.disposeTimeline(countHistories, `a`)
		const recreated = Uno.findTimeline(countHistories, `a`)
		expect(recreated).toEqual(history)
		expect(Uno.inspectTimeline(recreated)).toEqual({ at: 0, length: 0 })
		expect(hasImplicitStoreBeenCreated()).toBe(false)
	})
})
