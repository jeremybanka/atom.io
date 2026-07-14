import type {
	MutableAtomFamilyOptions,
	MutableAtomFamilyToken,
	ReadonlyPureSelectorFamilyOptions,
	RegularAtomOptions,
} from "atom.io"
import { getState, scopeFamily, Silo } from "atom.io"
import { hasImplicitStoreBeenCreated, stateExistsInStore } from "atom.io/testing"
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
	it(`keeps newly inserted font points in their glyph histories`, () => {
		type GlyphId = `A` | `B`
		type MasterId = `bold` | `preview` | `regular`
		type PointKey = readonly [glyphId: GlyphId, pointId: string]
		type CoordinateKey = readonly [
			masterId: MasterId,
			glyphId: GlyphId,
			pointId: string,
		]

		const FontEditor = new Silo({
			name: `font-editor`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		FontEditor.store.logger = createNullLogger()
		const glyphAtoms = FontEditor.atomFamily<{ name: string }, GlyphId>({
			key: `glyph`,
			default: (glyphId) => ({ name: glyphId }),
		})
		const pointAtoms = FontEditor.atomFamily<
			{ type: `off-curve` | `on-curve` },
			PointKey
		>({
			key: `point`,
			default: { type: `on-curve` },
		})
		const pointXAtoms = FontEditor.atomFamily<number, CoordinateKey>({
			key: `pointX`,
			default: 0,
		})
		const glyphHistories = FontEditor.timelineFamily<GlyphId>({
			key: `glyphHistory`,
			scope: [
				scopeFamily(glyphAtoms, { timelineKey: (glyphId) => glyphId }),
				scopeFamily(pointAtoms, {
					timelineKey: ([glyphId]) => glyphId,
				}),
				scopeFamily(pointXAtoms, {
					timelineKey: ([masterId, glyphId]) =>
						masterId === `preview` ? undefined : glyphId,
				}),
			],
		})

		const historyA = FontEditor.findTimeline(glyphHistories, `A`)
		const historyB = FontEditor.findTimeline(glyphHistories, `B`)
		const historyASubscriber = vitest.fn()
		FontEditor.subscribe(glyphHistories, `A`, historyASubscriber)

		// Load the existing outlines, then establish the editor's clean baseline.
		FontEditor.getState(glyphAtoms, `A`)
		FontEditor.getState(pointAtoms, [`A`, `p0`])
		FontEditor.getState(pointXAtoms, [`regular`, `A`, `p0`])
		FontEditor.getState(pointXAtoms, [`bold`, `A`, `p0`])
		FontEditor.getState(glyphAtoms, `B`)
		FontEditor.getState(pointAtoms, [`B`, `p0`])
		FontEditor.getState(pointXAtoms, [`regular`, `B`, `p0`])
		FontEditor.clearTimeline(glyphHistories, `A`)
		FontEditor.clearTimeline(glyphHistories, `B`)

		// Insert a point after the histories exist, as happens while drawing a glyph.
		FontEditor.setState(pointAtoms, [`A`, `p1`], { type: `on-curve` })
		FontEditor.setState(pointXAtoms, [`regular`, `A`, `p1`], 100)
		FontEditor.setState(pointXAtoms, [`bold`, `A`, `p1`], 110)
		FontEditor.clearTimeline(glyphHistories, `A`)

		// The reported regression was that moving this new point recorded nothing.
		FontEditor.setState(pointXAtoms, [`regular`, `A`, `p1`], 140)
		FontEditor.setState(pointXAtoms, [`preview`, `A`, `p1`], 999)
		expect(FontEditor.inspectTimeline(glyphHistories, `A`)).toEqual({
			at: 1,
			length: 1,
		})
		expect(FontEditor.inspectTimeline(glyphHistories, `B`)).toEqual({
			at: 0,
			length: 0,
		})
		expect(historyASubscriber).toHaveBeenCalled()

		FontEditor.undo(glyphHistories, `A`)
		expect(FontEditor.getState(pointXAtoms, [`regular`, `A`, `p1`])).toBe(100)
		expect(FontEditor.getState(pointXAtoms, [`preview`, `A`, `p1`])).toBe(999)
		FontEditor.redo(glyphHistories, `A`)
		expect(FontEditor.getState(pointXAtoms, [`regular`, `A`, `p1`])).toBe(140)

		FontEditor.setState(pointXAtoms, [`regular`, `B`, `p0`], 20)
		expect(FontEditor.inspectTimeline(historyA)).toEqual({ at: 1, length: 1 })
		expect(FontEditor.inspectTimeline(historyB)).toEqual({ at: 1, length: 1 })
		FontEditor.undo(glyphHistories, `B`)
		expect(FontEditor.getState(pointXAtoms, [`regular`, `B`, `p0`])).toBe(0)
		expect(FontEditor.getState(pointXAtoms, [`regular`, `A`, `p1`])).toBe(140)

		FontEditor.disposeTimeline(glyphHistories, `A`)
		const recreatedHistoryA = FontEditor.findTimeline(glyphHistories, `A`)
		expect(recreatedHistoryA).toEqual(historyA)
		expect(FontEditor.inspectTimeline(recreatedHistoryA)).toEqual({
			at: 0,
			length: 0,
		})
		expect(FontEditor.inspectTimeline(historyB)).toEqual({ at: 0, length: 1 })
		expect(hasImplicitStoreBeenCreated()).toBe(false)
	})
	it(`keeps selector-created extrema in their own glyph histories`, () => {
		type GlyphId = `A` | `B`
		type PointKey = readonly [glyphId: GlyphId, pointId: string]

		const FontEditor = new Silo({
			name: `font-editor-extrema`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		FontEditor.store.logger = createNullLogger()
		const pointXAtoms = FontEditor.atomFamily<number, PointKey>({
			key: `pointX`,
			default: 0,
		})
		const glyphHistories = FontEditor.timelineFamily<GlyphId>({
			key: `glyphHistory`,
			scope: [
				scopeFamily(pointXAtoms, {
					timelineKey: ([glyphId]) => glyphId,
				}),
			],
		})
		const addExtremaToGlyphsSelector = FontEditor.selector<readonly GlyphId[]>({
			key: `addExtremaToGlyphs`,
			get: () => [],
			set: ({ set }, glyphIds) => {
				for (const glyphId of glyphIds) {
					set(
						pointXAtoms,
						[glyphId, `top-extremum`],
						glyphId === `A` ? 100 : 200,
					)
				}
			},
		})

		FontEditor.findTimeline(glyphHistories, `A`)
		FontEditor.findTimeline(glyphHistories, `B`)

		// A batch "Add Extrema" command creates one new point in each glyph.
		FontEditor.setState(addExtremaToGlyphsSelector, [`A`, `B`])
		expect(FontEditor.inspectTimeline(glyphHistories, `A`)).toEqual({
			at: 1,
			length: 1,
		})
		expect(FontEditor.inspectTimeline(glyphHistories, `B`)).toEqual({
			at: 1,
			length: 1,
		})
		expect(
			stateExistsInStore(FontEditor.store, pointXAtoms, [`A`, `top-extremum`]),
		).toBe(true)
		expect(
			stateExistsInStore(FontEditor.store, pointXAtoms, [`B`, `top-extremum`]),
		).toBe(true)

		// Undoing A removes A's point without touching B's applied history.
		FontEditor.undo(glyphHistories, `A`)
		expect(
			stateExistsInStore(FontEditor.store, pointXAtoms, [`A`, `top-extremum`]),
		).toBe(false)
		expect(
			stateExistsInStore(FontEditor.store, pointXAtoms, [`B`, `top-extremum`]),
		).toBe(true)
		expect(FontEditor.getState(pointXAtoms, [`B`, `top-extremum`])).toBe(200)
		expect(FontEditor.inspectTimeline(glyphHistories, `B`)).toEqual({
			at: 1,
			length: 1,
		})
		expect(hasImplicitStoreBeenCreated()).toBe(false)
	})
	it(`undoes one batch edit across glyph histories`, () => {
		type GlyphId = `A` | `B`
		type PointKey = readonly [glyphId: GlyphId, pointId: string]

		const FontEditor = new Silo({
			name: `font-editor-batch`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		FontEditor.store.logger = createNullLogger()
		const pointXAtoms = FontEditor.atomFamily<number, PointKey>({
			key: `pointX`,
			default: 0,
		})
		const editedGlyphCountAtom = FontEditor.atom<number>({
			key: `editedGlyphCount`,
			default: 0,
		})
		const glyphHistories = FontEditor.timelineFamily<GlyphId>({
			key: `glyphHistory`,
			scope: [
				scopeFamily(pointXAtoms, {
					timelineKey: ([glyphId]) => glyphId,
				}),
			],
		})
		const addExtremaToGlyphsTX = FontEditor.transaction<
			(glyphIds: readonly GlyphId[]) => void
		>({
			key: `addExtremaToGlyphs`,
			do: ({ set }, glyphIds) => {
				set(editedGlyphCountAtom, glyphIds.length)
				for (const glyphId of glyphIds) {
					set(
						pointXAtoms,
						[glyphId, `top-extremum`],
						glyphId === `A` ? 100 : 200,
					)
				}
			},
		})
		const historyA = FontEditor.findTimeline(glyphHistories, `A`)
		const historyB = FontEditor.findTimeline(glyphHistories, `B`)

		FontEditor.runTransaction(addExtremaToGlyphsTX)([`A`, `B`])
		expect(FontEditor.getState(editedGlyphCountAtom)).toBe(2)
		expect(FontEditor.inspectTimeline(historyA)).toEqual({ at: 1, length: 1 })
		expect(FontEditor.inspectTimeline(historyB)).toEqual({ at: 1, length: 1 })

		// Local history remains available for editing one glyph in isolation.
		FontEditor.undo(glyphHistories, `A`)
		expect(
			stateExistsInStore(FontEditor.store, pointXAtoms, [`A`, `top-extremum`]),
		).toBe(false)
		expect(
			stateExistsInStore(FontEditor.store, pointXAtoms, [`B`, `top-extremum`]),
		).toBe(true)
		expect(FontEditor.inspectTimeline(historyA)).toEqual({ at: 0, length: 1 })
		expect(FontEditor.inspectTimeline(historyB)).toEqual({ at: 1, length: 1 })
		expect(FontEditor.getState(editedGlyphCountAtom)).toBe(2)

		const onCoordinatedUndo = vitest.fn(() => {
			expect(
				stateExistsInStore(FontEditor.store, pointXAtoms, [`A`, `top-extremum`]),
			).toBe(false)
			expect(
				stateExistsInStore(FontEditor.store, pointXAtoms, [`B`, `top-extremum`]),
			).toBe(false)
		})
		const unsubscribeFromHistoryB = FontEditor.subscribe(
			historyB,
			onCoordinatedUndo,
		)
		FontEditor.undoTransaction(addExtremaToGlyphsTX)
		expect(
			stateExistsInStore(FontEditor.store, pointXAtoms, [`A`, `top-extremum`]),
		).toBe(false)
		expect(
			stateExistsInStore(FontEditor.store, pointXAtoms, [`B`, `top-extremum`]),
		).toBe(false)
		expect(FontEditor.inspectTimeline(historyA)).toEqual({ at: 0, length: 1 })
		expect(FontEditor.inspectTimeline(historyB)).toEqual({ at: 0, length: 1 })
		// State outside the glyph histories is not replayed by coordinated travel.
		expect(FontEditor.getState(editedGlyphCountAtom)).toBe(2)
		expect(onCoordinatedUndo).toHaveBeenCalledOnce()
		unsubscribeFromHistoryB()

		// Redo discovers both timelines at the transaction's next head.
		FontEditor.redoTransaction(addExtremaToGlyphsTX)
		expect(
			stateExistsInStore(FontEditor.store, pointXAtoms, [`A`, `top-extremum`]),
		).toBe(true)
		expect(
			stateExistsInStore(FontEditor.store, pointXAtoms, [`B`, `top-extremum`]),
		).toBe(true)
		expect(FontEditor.inspectTimeline(historyA)).toEqual({ at: 1, length: 1 })
		expect(FontEditor.inspectTimeline(historyB)).toEqual({ at: 1, length: 1 })
		expect(FontEditor.getState(editedGlyphCountAtom)).toBe(2)
		expect(hasImplicitStoreBeenCreated()).toBe(false)
	})
	it(`retires an ordinary load history from its silo`, () => {
		const FontEditor = new Silo({
			name: `font-editor-load`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		FontEditor.store.logger = createNullLogger()
		const fontLoadGenerationAtom = FontEditor.atom<number>({
			key: `fontLoadGeneration`,
			default: 1,
		})
		const firstLoadTimeline = FontEditor.timeline({
			key: `firstLoad`,
			scope: [fontLoadGenerationAtom],
		})

		FontEditor.setState(fontLoadGenerationAtom, 2)
		expect(FontEditor.inspectTimeline(firstLoadTimeline)).toEqual({
			at: 1,
			length: 1,
		})

		// A reload workaround used to abandon these generated timelines in the store.
		FontEditor.disposeTimeline(firstLoadTimeline)
		expect(() => FontEditor.inspectTimeline(firstLoadTimeline)).toThrow()
		expect(hasImplicitStoreBeenCreated()).toBe(false)
	})
})
