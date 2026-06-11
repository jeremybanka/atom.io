import type { Logger } from "atom.io"
import {
	atomFamily,
	disposeState,
	findState,
	getState,
	resetState,
	runTransaction,
	selectorFamily,
	setState,
	transaction,
} from "atom.io"
import * as Internal from "atom.io/internal"
import { vitest } from "vitest"

const LOG_LEVELS = [null, `error`, `warn`, `info`] as const
const CHOOSE = 1

let logger: Logger

beforeEach(() => {
	Internal.clearStore(Internal.IMPLICIT.STORE)
	Internal.IMPLICIT.STORE.loggers[0].logLevel = LOG_LEVELS[CHOOSE]
	logger = Internal.IMPLICIT.STORE.logger
	vitest.spyOn(logger, `error`)
	vitest.spyOn(logger, `warn`)
	vitest.spyOn(logger, `info`)
})

describe(`atom families`, () => {
	it(`can be modified and retrieved`, () => {
		const coordinateAtoms = atomFamily<{ x: number; y: number }, string>({
			key: `coordinate`,
			default: { x: 0, y: 0 },
		})
		setState(findState(coordinateAtoms, `a`), { x: 1, y: 1 })
		expect(getState(findState(coordinateAtoms, `a`))).toEqual({ x: 1, y: 1 })
		resetState(coordinateAtoms, `a`)
		expect(getState(coordinateAtoms, `a`)).toEqual({ x: 0, y: 0 })
	})
	it(`blocks new members when maxMembers is reached`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
			maxMembers: 2,
			whenFull: `block`,
		})

		getState(countAtoms, `a`)
		getState(countAtoms, `b`)

		expect(() => getState(countAtoms, `c`)).toThrow(
			`atom_family "count" already has its maximum of 2 members`,
		)
		expect(Internal.IMPLICIT.STORE.atoms.has(`count("a")`)).toBe(true)
		expect(Internal.IMPLICIT.STORE.atoms.has(`count("b")`)).toBe(true)
		expect(Internal.IMPLICIT.STORE.atoms.has(`count("c")`)).toBe(false)
	})
	it(`allows new members after disposing old ones`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
			maxMembers: 1,
		})

		getState(countAtoms, `a`)
		disposeState(countAtoms, `a`)

		expect(() => getState(countAtoms, `b`)).not.toThrow()
		expect(Internal.IMPLICIT.STORE.atoms.has(`count("a")`)).toBe(false)
		expect(Internal.IMPLICIT.STORE.atoms.has(`count("b")`)).toBe(true)
	})
	it(`evicts the oldest member when maxMembers is reached`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
			maxMembers: 2,
			whenFull: `evict_oldest`,
		})

		setState(countAtoms, `a`, 1)
		setState(countAtoms, `b`, 2)
		setState(countAtoms, `c`, 3)

		expect(Internal.IMPLICIT.STORE.atoms.has(`count("a")`)).toBe(false)
		expect(Internal.IMPLICIT.STORE.atoms.has(`count("b")`)).toBe(true)
		expect(Internal.IMPLICIT.STORE.atoms.has(`count("c")`)).toBe(true)
		expect(getState(countAtoms, `b`)).toBe(2)
		expect(getState(countAtoms, `c`)).toBe(3)
	})
	it(`ignores members created in aborted transactions`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
			maxMembers: 2,
		})
		const addThenFail = transaction({
			key: `add_then_fail`,
			do: ({ set }) => {
				set(countAtoms, `b`, 1)
				throw new Error(`nope`)
			},
		})

		getState(countAtoms, `a`)

		expect(runTransaction(addThenFail)).toThrow(`nope`)
		expect(() => setState(countAtoms, `c`, 2)).not.toThrow()
		expect(Internal.IMPLICIT.STORE.atoms.has(`count("a")`)).toBe(true)
		expect(Internal.IMPLICIT.STORE.atoms.has(`count("b")`)).toBe(false)
		expect(Internal.IMPLICIT.STORE.atoms.has(`count("c")`)).toBe(true)
	})
})

describe(`selector families`, () => {
	it(`can be modified and retrieved`, () => {
		const pointAtoms = atomFamily<{ x: number; y: number }, string>({
			key: `point`,
			default: { x: 0, y: 0 },
		})
		const distanceSelectors = selectorFamily<number, [string, string]>({
			key: `distance`,
			get:
				([keyA, keyB]) =>
				({ get }) => {
					const pointA = get(pointAtoms, keyA)
					const pointB = get(pointAtoms, keyB)
					return Math.sqrt(
						(pointA.x - pointB.x) ** 2 + (pointA.y - pointB.y) ** 2,
					)
				},
			set:
				([keyA, keyB]) =>
				({ set }, newValue) => {
					const pointA = getState(pointAtoms, keyA)
					const pointB = getState(pointAtoms, keyB)
					const angle = Math.atan2(pointB.y - pointA.y, pointB.x - pointA.x)
					const vector = { x: Math.cos(angle), y: Math.sin(angle) }
					set(pointAtoms, keyB, {
						x: pointA.x + vector.x * newValue,
						y: pointA.y + vector.y * newValue,
					})
				},
		})
		setState(pointAtoms, `a`, { x: 1, y: 1 })
		setState(pointAtoms, `b`, { x: 2, y: 2 })
		expect(getState(distanceSelectors, [`a`, `b`])).toBe(Math.SQRT2)

		setState(pointAtoms, `b`, { x: 11, y: 11 })
		expect(getState(distanceSelectors, [`a`, `b`])).toBe(14.142135623730951)

		setState(distanceSelectors, [`a`, `b`], 1)
		expect(getState(pointAtoms, `a`)).toEqual({ x: 1, y: 1 })
		expect(getState(pointAtoms, `b`)).toEqual({
			x: Math.SQRT2 / 2 + 1,
			y: Math.SQRT2 / 2 + 1,
		})

		resetState(distanceSelectors, [`a`, `b`])
		expect(getState(pointAtoms, `a`)).toEqual({ x: 0, y: 0 })
		expect(getState(pointAtoms, `b`)).toEqual({ x: 0, y: 0 })
	})
	it(`implicitly creates in an ephemeral store`, () => {
		const arrayAtoms = atomFamily<number[], string>({
			key: `array`,
			default: [],
		})
		const lengthSelectors = selectorFamily<number, string>({
			key: `length`,
			get:
				(key) =>
				({ get }) => {
					const array = get(arrayAtoms, key)
					return array.length
				},
		})
		expect(getState(lengthSelectors, `hi`)).toBe(0)
	})
	it(`blocks new selector members when maxMembers is reached`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const doubledSelectors = selectorFamily<number, string>({
			key: `doubled`,
			maxMembers: 1,
			whenFull: `block`,
			get:
				(id) =>
				({ get }) =>
					get(countAtoms, id) * 2,
		})

		getState(doubledSelectors, `a`)

		expect(() => getState(doubledSelectors, `b`)).toThrow(
			`readonly_pure_selector_family "doubled" already has its maximum of 1 members`,
		)
		expect(Internal.IMPLICIT.STORE.readonlySelectors.has(`doubled("a")`)).toBe(
			true,
		)
		expect(Internal.IMPLICIT.STORE.readonlySelectors.has(`doubled("b")`)).toBe(
			false,
		)
	})
	it(`evicts the oldest selector member when maxMembers is reached`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const doubledSelectors = selectorFamily<number, string>({
			key: `doubled`,
			maxMembers: 1,
			whenFull: `evict_oldest`,
			get:
				(id) =>
				({ get }) =>
					get(countAtoms, id) * 2,
		})

		setState(countAtoms, `a`, 1)
		setState(countAtoms, `b`, 2)
		expect(getState(doubledSelectors, `a`)).toBe(2)
		expect(getState(doubledSelectors, `b`)).toBe(4)

		expect(Internal.IMPLICIT.STORE.readonlySelectors.has(`doubled("a")`)).toBe(
			false,
		)
		expect(Internal.IMPLICIT.STORE.readonlySelectors.has(`doubled("b")`)).toBe(
			true,
		)
	})
})
