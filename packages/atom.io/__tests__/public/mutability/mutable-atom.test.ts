import type { Logger } from "atom.io"
import {
	disposeState,
	findState,
	getJsonToken,
	getState,
	mutableAtom,
	mutableAtomFamily,
	redo,
	runTransaction,
	setState,
	subscribe,
	timeline,
	transaction,
	undo,
} from "atom.io"
import * as Internal from "atom.io/internal"
import { OList } from "atom.io/transceivers/o-list"
import { UList } from "atom.io/transceivers/u-list"
import { vitest } from "vitest"

import * as Utils from "../../__util__/index.ts"

const LOG_LEVELS = [null, `error`, `warn`, `info`] as const
const CHOOSE = 3

let logger: Logger

beforeEach(() => {
	Internal.clearStore(Internal.IMPLICIT.STORE)
	Internal.IMPLICIT.STORE.config.isProduction = true
	Internal.IMPLICIT.STORE.loggers[0].logLevel = LOG_LEVELS[CHOOSE]
	logger = Internal.IMPLICIT.STORE.logger = Utils.createNullLogger()
	vitest.spyOn(logger, `error`).mockReset()
	vitest.spyOn(logger, `warn`).mockReset()
	vitest.spyOn(logger, `info`).mockReset()
	vitest.spyOn(Utils, `stdout`).mockReset()
	vitest.spyOn(Utils, `stdout0`).mockReset()
	vitest.spyOn(Utils, `stdout1`).mockReset()
})

describe(`mutable atomic state`, () => {
	it(`must hold a Transceiver whose changes can be tracked`, () => {
		const myMutableAtom = mutableAtom<UList<string>>({
			key: `myMutable`,
			class: UList,
		})
		const myJsonState = getJsonToken(myMutableAtom)
		let trackedUpdate: string | undefined
		getState(myMutableAtom).subscribe(`test`, (update) => {
			trackedUpdate = update
		})
		subscribe(myMutableAtom, Utils.stdout0)
		subscribe(myJsonState, Utils.stdout1)
		setState(myMutableAtom, (set) => set.add(`a`))
		expect(Utils.stdout0).toHaveBeenCalledWith({
			newValue: new UList([`a`]),
			oldValue: new UList([`a`]),
		})
		expect(Utils.stdout1).toHaveBeenCalledWith({
			newValue: [`a`],
			oldValue: [],
		})
		if (trackedUpdate === undefined) {
			throw new Error(`Expected the mutable atom to emit an update.`)
		}
		const replayed = new UList<string>()
		replayed.do(trackedUpdate)
		expect(replayed).toEqual(new UList([`a`]))
		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.error).not.toHaveBeenCalled()
	})

	it(`has its own family function for ease of use`, () => {
		const userFlagsAtoms = mutableAtomFamily<OList<string>, string>({
			key: `userFlags`,
			class: OList,
		})

		const myFlagsState = findState(userFlagsAtoms, `my-user-id`)
		const findFlagsByUserIdJSON = getJsonToken(userFlagsAtoms, `my-user-id`)

		let trackedUpdate: string | undefined
		getState(myFlagsState).subscribe(`test`, (update) => {
			trackedUpdate = update
		})
		subscribe(myFlagsState, Utils.stdout0)
		subscribe(findFlagsByUserIdJSON, Utils.stdout1)

		setState(myFlagsState, (ol) => ((ol[0] = `a`), ol))

		expect(Utils.stdout0).toHaveBeenCalledTimes(1)
		expect(Utils.stdout1).toHaveBeenCalledWith({
			newValue: [`a`],
			oldValue: [],
		})
		if (trackedUpdate === undefined) {
			throw new Error(
				`Expected the mutable atom family member to emit an update.`,
			)
		}
		const replayed = new OList<string>()
		replayed.do(trackedUpdate)
		expect(replayed).toEqual(new OList(`a`))
		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.error).not.toHaveBeenCalled()
	})

	it(`can recover from a failed transaction`, () => {
		const myMutableAtom = mutableAtom<UList<string>>({
			key: `myMutable`,
			class: UList,
		})

		const myTransaction = transaction({
			key: `myTx`,
			do: ({ set }) => {
				set(myMutableAtom, (mySet) => {
					mySet.add(`a`)
					mySet.add(`b`)
					return mySet
				})
				throw new Error(`failed transaction`)
			},
		})

		const myJsonState = getJsonToken(myMutableAtom)
		subscribe(myJsonState, Utils.stdout)

		let caught: unknown
		try {
			runTransaction(myTransaction)()
		} catch (thrown) {
			caught = thrown
		} finally {
			expect(caught).toBeInstanceOf(Error)
			expect(Utils.stdout).not.toHaveBeenCalledWith({
				oldValue: [],
				newValue: [`a`, `b`],
			})
			const myMutable = getState(myMutableAtom)
			expect(myMutable).toEqual(new UList())
		}
	})
})

describe(`mutable time traveling`, () => {
	afterEach(() => {
		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.error).not.toHaveBeenCalled()
	})
	it(`can travel back and forward in time`, () => {
		const myMutableAtoms = mutableAtomFamily<UList<string>, string>({
			key: `myMutable`,
			class: UList,
		})
		const myMutableAtom = findState(myMutableAtoms, `example`)
		const myTL = timeline({
			key: `myTimeline`,
			scope: [myMutableAtoms],
		})
		subscribe(myMutableAtom, Utils.stdout0)

		expect(getState(myMutableAtom)).toEqual(new UList())
		setState(myMutableAtom, (set) => set.add(`a`))
		expect(getState(myMutableAtom)).toEqual(new UList([`a`]))
		setState(myMutableAtom, (set) => set.add(`b`))
		expect(getState(myMutableAtom)).toEqual(new UList([`a`, `b`]))
		undo(myTL)
		expect(getState(myMutableAtom)).toEqual(new UList([`a`]))
		undo(myTL)
		expect(getState(myMutableAtom)).toEqual(new UList())
		redo(myTL)
		expect(getState(myMutableAtom)).toEqual(new UList([`a`]))
		redo(myTL)
		expect(getState(myMutableAtom)).toEqual(new UList([`a`, `b`]))
	})
	it(`can travel back and forward in time with a transaction`, () => {
		const myMutableAtom = mutableAtom<UList<string>>({
			key: `myMutable`,
			class: UList,
		})
		const myTL = timeline({
			key: `myTimeline`,
			scope: [myMutableAtom],
		})
		const myTX = transaction<(newItem: string) => void>({
			key: `myTransaction`,
			do: ({ set }, newItem) => {
				set(myMutableAtom, (s) => s.add(newItem))
			},
		})

		subscribe(myMutableAtom, Utils.stdout0)

		expect(getState(myMutableAtom)).toEqual(new UList())
		runTransaction(myTX)(`a`)
		expect(getState(myMutableAtom)).toEqual(new UList([`a`]))
		runTransaction(myTX)(`b`)
		expect(getState(myMutableAtom)).toEqual(new UList([`a`, `b`]))
		undo(myTL)
		expect(getState(myMutableAtom)).toEqual(new UList([`a`]))
		undo(myTL)
		expect(getState(myMutableAtom)).toEqual(new UList())
		redo(myTL)
		expect(getState(myMutableAtom)).toEqual(new UList([`a`]))
		redo(myTL)
		expect(getState(myMutableAtom)).toEqual(new UList([`a`, `b`]))
	})
})

describe(`mutable atom effects`, () => {
	afterEach(() => {
		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.error).not.toHaveBeenCalled()
	})
	it(`runs a callback when the atom is set`, () => {
		let setSize = 0
		const myMutableAtoms = mutableAtomFamily<UList<string>, string>({
			key: `myMutable`,
			class: UList,
			effects: () => [
				({ onSet }) => {
					onSet(({ newValue }) => {
						setSize += newValue.size
					})
					return () => {
						setSize = 0
					}
				},
			],
		})

		setState(myMutableAtoms, `myMutableState`, (prev) => prev.add(`a`))
		expect(setSize).toBe(1)
		disposeState(myMutableAtoms, `myMutableState`)
		expect(setSize).toBe(0)
	})
	it(`can set a mutable atom in response to an external event`, () => {
		const letterSubject = new Internal.StatefulSubject<{ letter: string }>({
			letter: `A`,
		})
		const myMutableAtom = mutableAtom<UList<string>>({
			key: `myMutable`,
			class: UList,
			effects: [
				({ setSelf }) => {
					const unsubscribe = letterSubject.subscribe(
						`mutable atom effect`,
						({ letter }) => {
							setSelf((s) => s.add(letter))
						},
					)
					return unsubscribe
				},
			],
		})

		letterSubject.next({ letter: `A` })
		expect(getState(myMutableAtom)).toEqual(new UList([`A`]))
		letterSubject.next({ letter: `B` })
		expect(getState(myMutableAtom)).toEqual(new UList([`A`, `B`]))
	})
})

describe(`graceful handling of hmr/duplicate atom keys`, () => {
	it(`logs an error if an atom is created with the same key as an existing atom`, () => {
		const myMutableAtom = mutableAtom<UList<string>>({
			key: `myMutable`,
			class: UList,
		})
		mutableAtom<UList<string>>({
			key: `myMutable`,
			class: UList,
		})
		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.error).toHaveBeenCalledTimes(1)
		expect(logger.error).toHaveBeenCalledWith(
			`❌`,
			myMutableAtom.type,
			myMutableAtom.key,
			`Tried to create atom, but it already exists in the store.`,
		)
	})
})
