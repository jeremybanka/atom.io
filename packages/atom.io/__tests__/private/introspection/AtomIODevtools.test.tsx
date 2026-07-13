import { act, fireEvent, render, waitFor } from "@testing-library/react"
import type { Logger } from "atom.io"
import { scopeFamily, Silo } from "atom.io"
import * as AR from "atom.io/react"
import { AtomIODevtools } from "atom.io/react-devtools"
import { UList } from "atom.io/transceivers/u-list"

import * as Utils from "../../__util__/index.ts"

/* eslint-disable no-console */
console.log = () => undefined
console.info = () => undefined
/* eslint-enable no-console */

const LOG_LEVELS = [null, `error`, `warn`, `info`] as const
const CHOOSE = 2

let i = 0
let $: Silo
let willClearLocalStorage = false
let logger: Logger

beforeEach(() => {
	if (willClearLocalStorage) localStorage.clear()
	$ = new Silo({
		name: `react-store-${i}`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	$.store.loggers[0].logLevel = LOG_LEVELS[CHOOSE]
	logger = $.store.logger = Utils.createNullLogger()
	vitest.spyOn(logger, `error`)
	vitest.spyOn(logger, `warn`)
	vitest.spyOn(logger, `info`)
	vitest.spyOn(Utils, `stdout`)
	i++
	willClearLocalStorage = true
})

afterEach(() => {
	expect(logger.warn).not.toHaveBeenCalled()
	expect(logger.error).not.toHaveBeenCalled()
})

const scenario = () =>
	render(
		<AR.StoreProvider store={$.store}>
			<AtomIODevtools />
		</AR.StoreProvider>,
	)

async function actAsync(
	callback: (() => void) | (() => Promise<void>),
): Promise<void> {
	await act(callback)
}

describe(`editing primitive atoms of a variety of types`, () => {
	test(`string`, async () => {
		const myStringAtom = $.atom<string>({ key: `myString`, default: `A` })

		const { getByTestId } = scenario()

		await actAsync(() => {
			const myStringInput = getByTestId(`myString-state-editor-string-input`)
			fireEvent.change(myStringInput, { target: { value: `hello` } })
		})

		expect($.getState(myStringAtom)).toBe(`hello`)
	})

	test(`number`, async () => {
		const myNumberAtom = $.atom<number>({ key: `myNumber`, default: 0 })

		const { getByTestId } = scenario()

		await actAsync(() => {
			const myNumberInput = getByTestId(`myNumber-state-editor-number-input`)
			fireEvent.change(myNumberInput, { target: { value: `1` } })
		})

		expect($.getState(myNumberAtom)).toBe(1)
		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.error).not.toHaveBeenCalled()
	})

	test(`boolean`, async () => {
		const myBooleanAtom = $.atom<boolean>({ key: `myBoolean`, default: false })

		const { getByTestId } = scenario()

		await actAsync(() => {
			const myBooleanInput = getByTestId(`myBoolean-state-editor-boolean-input`)
			fireEvent.click(myBooleanInput)
		})

		expect($.getState(myBooleanAtom)).toBe(true)
	})

	test(`null`, async () => {
		const myNullAtom = $.atom<null>({ key: `myNull`, default: null })

		const { getByTestId } = scenario()

		await actAsync(() => {
			const myNullInput = getByTestId(`myNull-state-editor-null`)
			fireEvent.click(myNullInput)
		})

		expect($.getState(myNullAtom)).toBe(null)
	})
})

describe(`editing an object atom`, () => {
	test(`object`, async () => {
		const myObjectAtom = $.atom<Record<string, number>>({
			key: `myObject`,
			default: { a: 1, b: 2 },
		})

		const { getByTestId /* debug */ } = scenario()

		await waitFor(() => getByTestId(`open-close-state-myObject`))

		await actAsync(() => {
			getByTestId(`open-close-state-myObject`).click()
		})

		await waitFor(() => getByTestId(`myObject-state-editor-property-a`))
		await waitFor(() => getByTestId(`myObject-state-editor-property-b`))

		await actAsync(() => {
			fireEvent.change(getByTestId(`myObject-state-editor-property-a-rename`), {
				target: { value: `c` },
			})
		})

		await waitFor(() =>
			getByTestId(`myObject-state-editor-property-c-number-input`),
		)

		// debug()
		expect($.getState(myObjectAtom)).toEqual({ b: 2, c: 1 })

		await actAsync(() => {
			fireEvent.change(
				getByTestId(`myObject-state-editor-property-c-number-input`),
				{
					target: { value: `3` },
				},
			)
		})

		expect($.getState(myObjectAtom)).toEqual({ b: 2, c: 3 })

		expect(JSON.stringify($.getState(myObjectAtom))).toBe(`{"c":3,"b":2}`)
		await actAsync(() => {
			getByTestId(`myObject-state-editor-sort-properties`).click()
		})
		expect(JSON.stringify($.getState(myObjectAtom))).toBe(`{"b":2,"c":3}`)

		await actAsync(() => {
			getByTestId(`myObject-state-editor-property-c-delete`).click()
		})

		expect($.getState(myObjectAtom)).toEqual({ b: 2 })

		await actAsync(() => {
			getByTestId(`myObject-state-editor-add-property`).click()
		})

		await actAsync(() => {
			fireEvent.change(
				getByTestId(`myObject-state-editor-property-new_property-rename`),
				{
					target: { value: `e` },
				},
			)
		})

		await waitFor(() => getByTestId(`myObject-state-editor-property-e`))
		expect($.getState(myObjectAtom)).toEqual({ b: 2, e: `` })

		await actAsync(() => {
			fireEvent.change(getByTestId(`myObject-state-editor-property-e-recast`), {
				target: { value: `number` },
			})
		})

		expect($.getState(myObjectAtom)).toEqual({ b: 2, e: 0 })
	})
	test(`nested object`, async () => {
		const myObjectAtom = $.atom<Record<string, Record<string, number>>>({
			key: `myObject`,
			default: { a: { b: 1 } },
		})

		const { getByTestId /* debug */ } = scenario()

		await waitFor(() => getByTestId(`open-close-state-myObject`))

		expect($.getState(myObjectAtom)).toEqual({ a: { b: 1 } })

		await actAsync(() => {
			getByTestId(`open-close-state-myObject`).click()
		})

		await waitFor(() => getByTestId(`myObject-state-editor-property-a`))

		await actAsync(() => {
			getByTestId(`myObject-state-editor-property-a-open-close`).click()
		})
		await waitFor(() =>
			getByTestId(`myObject-state-editor-property-a-property-b`),
		)

		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.error).not.toHaveBeenCalled()
	})
})

describe(`editing an array atom`, () => {
	test(`array`, async () => {
		const myArrayAtom = $.atom<string[]>({ key: `myArray`, default: [`A`] })

		const { getByTestId /* debug */ } = scenario()

		await waitFor(() => getByTestId(`open-close-state-myArray`))

		await actAsync(() => {
			getByTestId(`open-close-state-myArray`).click()
		})

		await waitFor(() => getByTestId(`myArray-state-editor-element-0`))

		await actAsync(() => {
			fireEvent.change(
				getByTestId(`myArray-state-editor-element-0-string-input`),
				{
					target: { value: `B` },
				},
			)
		})

		expect($.getState(myArrayAtom)).toEqual([`B`])

		await actAsync(() => {
			getByTestId(`myArray-state-editor-add-element`).click()
		})
		expect($.getState(myArrayAtom)).toEqual([`B`, ``])

		// recast to number
		await actAsync(() => {
			fireEvent.change(getByTestId(`myArray-state-editor-element-1-recast`), {
				target: { value: `number` },
			})
		})
		expect($.getState(myArrayAtom)).toEqual([`B`, 0])

		await actAsync(() => {
			getByTestId(`myArray-state-editor-element-1-delete`).click()
		})
		expect($.getState(myArrayAtom)).toEqual([`B`])

		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.error).not.toHaveBeenCalled()
	})
})

describe(`displaying non-JSON`, () => {
	test(`undefined`, async () => {
		$.atom<undefined>({ key: `myUndefined`, default: undefined })

		const { getByTestId } = scenario()

		getByTestId(`state-myUndefined`)
		await actAsync(() => {})
		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.error).not.toHaveBeenCalled()
	})
})

describe(`editing selectors`, () => {
	test(`selector that depends on an atom`, async () => {
		const letterAtom = $.atom<string>({ key: `letter`, default: `A` })
		const _doubleLetterSelector = $.selector<string>({
			key: `_doubleLetter`,
			get: ({ get }) => get(letterAtom) + get(letterAtom),
		})

		const { getByTestId } = scenario()

		await actAsync(() => {
			getByTestId(`view-selectors`).click()
		})
		await waitFor(() => getByTestId(`state-_doubleLetter`))
	})

	test(`selector that filters a SetRTX`, async () => {
		const selectionsAtom = $.mutableAtom<UList<string>>({
			key: `selections`,
			class: UList,
		})
		const _selectionsWithoutGreenSelector = $.selector<Set<string>>({
			key: `_selectionsWithoutGreen`,
			get: ({ get }) => {
				const selectionsWithGreen = get(selectionsAtom)
				const selectionsWithoutGreen = new Set(selectionsWithGreen)
				selectionsWithoutGreen.delete(`green`)
				return selectionsWithoutGreen
			},
		})

		const { getByTestId } = scenario()

		await actAsync(() => {
			getByTestId(`view-selectors`).click()
		})
		await waitFor(() => getByTestId(`state-_selectionsWithoutGreen`))
	})
})

describe(`displaying readonly selectors`, () => {
	test(`array selector`, async () => {
		const selectionsAtom = $.atom<number[]>({
			key: `selections`,
			default: [1, 2, 3],
		})
		const _evenSelectionsSelector = $.selector<number[]>({
			key: `_evenSelections`,
			get: ({ get }) => get(selectionsAtom).filter((n) => n % 2 === 0),
		})

		const { getByTestId } = scenario()

		await actAsync(() => {
			getByTestId(`view-selectors`).click()
		})

		await waitFor(() => getByTestId(`open-close-state-_evenSelections`))
		await actAsync(() => {
			getByTestId(`open-close-state-_evenSelections`).click()
		})

		await waitFor(() => getByTestId(`_evenSelections-state-editor-element-0`))

		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.error).not.toHaveBeenCalled()
	})
})

describe(`working with families`, () => {
	test(`atom family`, async () => {
		const countAtoms = $.atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const _countAtomA = $.getState(countAtoms, `A`)
		const _countAtomB = $.getState(countAtoms, `B`)

		const { getByTestId } = scenario()

		await actAsync(() => {
			getByTestId(`open-close-state-family-count`).click()
		})
		await waitFor(() => getByTestId(`state-count("A")`))
		await waitFor(() => getByTestId(`state-count("B")`))

		await actAsync(() => {
			fireEvent.change(getByTestId(`count("A")-state-editor-number-input`), {
				target: { value: `1` },
			})
		})
	})
})

describe(`working with transactions`, () => {
	test(`simple transaction`, async () => {
		const letterAtom = $.atom<string>({ key: `letter`, default: `A` })
		const setLetterTX = $.transaction<(newLetter: string) => void>({
			key: `setLetter`,
			do: ({ set }, newLetter) => {
				set(letterAtom, newLetter)
			},
		})

		const { getByTestId } = scenario()

		await actAsync(() => {
			getByTestId(`view-transactions`).click()
		})
		await waitFor(() => getByTestId(`transaction-setLetter`))

		await actAsync(() => {
			getByTestId(`open-close-transaction-setLetter`).click()
		})

		await actAsync(() => {
			$.runTransaction(setLetterTX)(`B`)
		})

		await waitFor(() => getByTestId(`transaction-update-setLetter-0`))
	})
})

describe(`working with timelines`, () => {
	test(`basic timeline`, async () => {
		const countAtom = $.atom<number>({ key: `count`, default: 0 })
		const doubleSelector = $.selector<number>({
			key: `double`,
			get: ({ get }) => get(countAtom) * 2,
			set: ({ set }, newValue) => {
				set(countAtom, newValue / 2)
			},
		})
		const decrementTX = $.transaction<() => void>({
			key: `reset`,
			do: ({ set }) => {
				set(countAtom, (c) => c - 1)
			},
		})
		const tripleAndDecrementTX = $.transaction<() => void>({
			key: `tripleAndDecrement`,
			do: ({ get, set, run }) => {
				set(countAtom, (c) => c + get(doubleSelector))
				run(decrementTX)()
			},
		})
		const _letterTL = $.timeline({
			key: `countTL`,
			scope: [countAtom],
		})

		const { getByTestId /* debug */ } = scenario()

		await actAsync(() => {
			getByTestId(`view-timelines`).click()
		})

		await waitFor(() => getByTestId(`timeline-countTL`))

		await actAsync(() => {
			getByTestId(`open-close-timeline-countTL`).click()
		})

		await actAsync(() => {
			$.setState(countAtom, 1)
		})

		await waitFor(() => getByTestId(`timeline-update-count-0`))

		await actAsync(() => {
			$.setState(doubleSelector, 2)
		})

		await waitFor(() => getByTestId(`timeline-update-double-1`))

		await actAsync(() => {
			$.runTransaction(tripleAndDecrementTX)()
		})

		await waitFor(() => getByTestId(`timeline-update-tripleAndDecrement-2`))
	})
	test(`timeline family members are grouped and removed on disposal`, async () => {
		const countAtoms = $.atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countHistories = $.timelineFamily<string>({
			key: `countHistory`,
			scope: [scopeFamily(countAtoms, { timelineKey: (countKey) => countKey })],
		})
		const countHistory = $.findTimeline(countHistories, `a`)
		const { getByTestId, queryByTestId } = scenario()

		await actAsync(() => {
			getByTestId(`view-timelines`).click()
		})
		await waitFor(() => getByTestId(`timeline-family-countHistory`))
		expect(getByTestId(`timeline-${countHistory.key}`)).toBeTruthy()

		await actAsync(() => {
			$.disposeTimeline(countHistory)
		})
		await waitFor(() => {
			expect(queryByTestId(`timeline-${countHistory.key}`)).toBeNull()
			expect(queryByTestId(`timeline-family-countHistory`)).toBeNull()
		})
	})
})

describe(`miscellaneous tool behavior`, () => {
	test(`closing the devtools`, async () => {
		willClearLocalStorage = false

		$.atom<boolean>({ key: `example`, default: true })

		const { getByTestId } = scenario()

		await waitFor(() => getByTestId(`example-state-editor-boolean-input`))

		await actAsync(() => {
			$.setState({ type: `atom`, key: `🔍 Devtools Are Open` }, false)
		})

		await waitFor(() => {
			try {
				getByTestId(`example-state-editor-boolean-input`)
			} catch (_) {
				return
			}
			throw new Error(`Expected element to not be found`)
		})
		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.error).not.toHaveBeenCalled()
	})
	test(`stays closed between reloads`, async () => {
		$.atom<boolean>({ key: `example`, default: true })

		const { getByTestId } = scenario()

		await waitFor(() => {
			try {
				getByTestId(`example-state-editor-boolean-input`)
			} catch (_) {
				return
			}
			throw new Error(`Expected element to not be found`)
		})
	})
	test(`hiding/un-hiding the devtools`, async () => {
		const { getByTestId } = scenario()

		await waitFor(() => getByTestId(`devtools`))

		await actAsync(() => {
			fireEvent.keyDown(document.body, {
				key: `a`,
				ctrlKey: true,
				shiftKey: true,
			})
		})

		await waitFor(() => {
			try {
				getByTestId(`devtools`)
			} catch (_) {
				return
			}
			throw new Error(`Expected element to not be found`)
		})
	})
})

describe(`devtools multi-expand/collapse`, () => {
	test(`expand all atoms`, async () => {
		$.atom<{ a: boolean }>({ key: `exampleA`, default: { a: true } })
		$.atom<{ b: boolean }>({ key: `exampleB`, default: { b: true } })

		const { getByTestId } = scenario()

		await waitFor(() => getByTestId(`open-close-state-exampleA`))
		await waitFor(() => getByTestId(`open-close-state-exampleB`))

		await actAsync(() => {
			const openCloseA = getByTestId(`open-close-state-exampleA`)
			fireEvent.click(openCloseA, { shiftKey: true })
		})

		await waitFor(() =>
			getByTestId(`exampleA-state-editor-property-a-boolean-input`),
		)
		await waitFor(() =>
			getByTestId(`exampleB-state-editor-property-b-boolean-input`),
		)
	})
	test(`expand all family members`, async () => {
		const exampleSelectors = $.selectorFamily<
			{ opt: Record<`bar` | `foo`, null> },
			string
		>({
			key: `example`,
			get: () => () => ({ opt: { foo: null, bar: null } }),
		})
		$.getState(exampleSelectors, `a`)
		$.getState(exampleSelectors, `b`)
		$.getState(exampleSelectors, `c`)

		const { getByTestId } = scenario()

		await actAsync(() => {
			getByTestId(`view-selectors`).click()
		})

		await waitFor(() => getByTestId(`state-example`))

		await actAsync(() => {
			const openCloseA = getByTestId(`open-close-state-family-example`)
			fireEvent.click(openCloseA, { shiftKey: true })
		})

		await waitFor(() => getByTestId(`state-example("a")`))

		await actAsync(() => {
			const openCloseA = getByTestId(`open-close-state-example("a")`)
			fireEvent.click(openCloseA, { shiftKey: true })
		})
		await waitFor(() => getByTestId(`example("a")-state-editor-property-opt`))
		await waitFor(() => getByTestId(`example("b")-state-editor-property-opt`))
		await waitFor(() => getByTestId(`example("c")-state-editor-property-opt`))

		await actAsync(() => {
			const openCloseAOpt = getByTestId(
				`example("a")-state-editor-property-opt-open-close`,
			)
			fireEvent.click(openCloseAOpt, { shiftKey: true })
		})

		await waitFor(() =>
			getByTestId(`example("a")-state-editor-property-opt-property-foo`),
		)
		await waitFor(() =>
			getByTestId(`example("a")-state-editor-property-opt-property-bar`),
		)
	})

	test(`expand all properties at a certain depth (object)`, async () => {
		$.atom<object>({
			key: `myNestedObject`,
			default: {
				dict: {
					a: { thing: true },
					b: { thing: true },
					c: { thing: true },
				},
			},
		})

		const { getByTestId } = scenario()

		await actAsync(() => {
			getByTestId(`open-close-state-myNestedObject`).click()
		})

		await waitFor(() => getByTestId(`myNestedObject-state-editor-property-dict`))

		await actAsync(() => {
			getByTestId(`myNestedObject-state-editor-property-dict-open-close`).click()
		})

		await waitFor(() =>
			getByTestId(`myNestedObject-state-editor-property-dict-property-a`),
		)
		await waitFor(() =>
			getByTestId(`myNestedObject-state-editor-property-dict-property-b`),
		)
		await waitFor(() =>
			getByTestId(`myNestedObject-state-editor-property-dict-property-c`),
		)

		await actAsync(() => {
			const openCloseA = getByTestId(
				`myNestedObject-state-editor-property-dict-property-a-open-close`,
			)
			fireEvent.click(openCloseA, { shiftKey: true })
		})

		await waitFor(() =>
			getByTestId(
				`myNestedObject-state-editor-property-dict-property-a-property-thing`,
			),
		)
		await waitFor(() =>
			getByTestId(
				`myNestedObject-state-editor-property-dict-property-b-property-thing`,
			),
		)
		await waitFor(() =>
			getByTestId(
				`myNestedObject-state-editor-property-dict-property-c-property-thing`,
			),
		)
	})

	test(`expand all properties at a certain depth (array)`, async () => {
		$.atom<object>({
			key: `myNestedObject`,
			default: {
				list: [{ thing: true }, { thing: true }, { thing: true }],
			},
		})

		const { getByTestId } = scenario()

		await actAsync(() => {
			getByTestId(`open-close-state-myNestedObject`).click()
		})

		await waitFor(() => getByTestId(`myNestedObject-state-editor-property-list`))

		await actAsync(() => {
			getByTestId(`myNestedObject-state-editor-property-list-open-close`).click()
		})

		await waitFor(() =>
			getByTestId(`myNestedObject-state-editor-property-list-element-0`),
		)
		await waitFor(() =>
			getByTestId(`myNestedObject-state-editor-property-list-element-1`),
		)
		await waitFor(() =>
			getByTestId(`myNestedObject-state-editor-property-list-element-2`),
		)

		await actAsync(() => {
			const openCloseA = getByTestId(
				`myNestedObject-state-editor-property-list-element-0-open-close`,
			)
			fireEvent.click(openCloseA, { shiftKey: true })
		})

		await waitFor(() =>
			getByTestId(
				`myNestedObject-state-editor-property-list-element-0-property-thing`,
			),
		)
		await waitFor(() =>
			getByTestId(
				`myNestedObject-state-editor-property-list-element-1-property-thing`,
			),
		)
		await waitFor(() =>
			getByTestId(
				`myNestedObject-state-editor-property-list-element-2-property-thing`,
			),
		)
	})
})
