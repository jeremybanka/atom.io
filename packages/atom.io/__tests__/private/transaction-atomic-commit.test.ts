import type {
	Loadable,
	TransactionOutcomeEvent,
	TransactionToken,
} from "atom.io"
import {
	atom,
	getState,
	inspectTimeline,
	runTransaction,
	selector,
	setState,
	subscribe,
	timeline,
	transaction,
	undo,
} from "atom.io"
import * as Internal from "atom.io/internal"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"
import { vitest } from "vitest"

const { restore } = takeSnapshot()

type ReplayOutcome = TransactionOutcomeEvent<TransactionToken<() => void>>

function replayOutcome(
	token: ReplayOutcome[`token`],
	subEvents: ReplayOutcome[`subEvents`],
): ReplayOutcome {
	return {
		type: `transaction_outcome`,
		token,
		id: `replay`,
		timestamp: 0,
		subEvents,
		params: [],
		output: undefined,
	}
}

beforeEach(() => {
	restore()
	setTestLogLevel(null)
})

describe(`atomic transaction commits`, () => {
	it(`settles every atom value before notifying subscribers`, () => {
		const aAtom = atom<string>({ key: `a`, default: `old a` })
		const bAtom = atom<string>({ key: `b`, default: `old b` })
		const updateTransaction = transaction<() => void>({
			key: `update`,
			do: ({ set }) => {
				set(aAtom, `new a`)
				set(bAtom, `new b`)
			},
		})
		const snapshots: string[][] = []
		const observe = () => snapshots.push([getState(aAtom), getState(bAtom)])

		subscribe(aAtom, observe)
		subscribe(bAtom, observe)
		runTransaction(updateTransaction)()

		expect(snapshots).toEqual([
			[`new a`, `new b`],
			[`new a`, `new b`],
		])
	})

	it(`recomputes a shared selector once from the settled snapshot`, () => {
		const aAtom = atom<number>({ key: `a`, default: 1 })
		const bAtom = atom<number>({ key: `b`, default: 2 })
		const compute = vitest.fn((left: number, right: number) => left + right)
		const sumSelector = selector<number>({
			key: `sum`,
			get: ({ get }) => compute(get(aAtom), get(bAtom)),
		})
		const updateTransaction = transaction<() => void>({
			key: `update`,
			do: ({ set }) => {
				set(aAtom, 10)
				set(bAtom, 20)
			},
		})
		const updates = vitest.fn()

		subscribe(sumSelector, updates)
		expect(getState(sumSelector)).toBe(3)
		compute.mockClear()
		runTransaction(updateTransaction)()

		expect(getState(sumSelector)).toBe(30)
		expect(compute).toHaveBeenCalledTimes(1)
		expect(updates).toHaveBeenCalledOnce()
		expect(updates).toHaveBeenCalledWith({ oldValue: 3, newValue: 30 })
	})

	it(`recomputes a pending async selector once from the settled snapshot`, () => {
		const aAtom = atom<number>({ key: `a`, default: 0 })
		const bAtom = atom<number>({ key: `b`, default: 0 })
		const snapshots: number[][] = []
		const pendingSelector = selector<Loadable<number>>({
			key: `pending`,
			get: ({ get }) => {
				snapshots.push([get(aAtom), get(bAtom)])
				return new Promise<number>(() => {})
			},
		})
		const updateTransaction = transaction<() => void>({
			key: `update`,
			do: ({ set }) => {
				set(aAtom, 1)
				set(bAtom, 2)
			},
		})
		const updates = vitest.fn()

		subscribe(pendingSelector, updates)
		snapshots.length = 0
		runTransaction(updateTransaction)()

		expect(snapshots).toEqual([[1, 2]])
		expect(updates).toHaveBeenCalledOnce()
	})

	it(`coalesces repeated writes without rewriting transaction history`, () => {
		const countAtom = atom<number>({ key: `count`, default: 0 })
		const updateTransaction = transaction<() => void>({
			key: `update`,
			do: ({ set }) => {
				set(countAtom, 1)
				set(countAtom, 2)
				set(countAtom, 3)
			},
		})
		const stateUpdates = vitest.fn()
		let outcome: TransactionOutcomeEvent<typeof updateTransaction> | undefined

		subscribe(countAtom, stateUpdates)
		subscribe(updateTransaction, (event) => {
			outcome = event
		})
		runTransaction(updateTransaction)()

		expect(stateUpdates).toHaveBeenCalledOnce()
		expect(stateUpdates).toHaveBeenCalledWith({ oldValue: 0, newValue: 3 })
		expect(outcome?.subEvents).toHaveLength(3)
	})

	it(`uses the outer commit boundary for nested transactions`, () => {
		const aAtom = atom<number>({ key: `a`, default: 0 })
		const bAtom = atom<number>({ key: `b`, default: 0 })
		const innerTransaction = transaction<() => void>({
			key: `inner`,
			do: ({ set }) => {
				set(bAtom, 2)
			},
		})
		const outerTransaction = transaction<() => void>({
			key: `outer`,
			do: ({ run, set }) => {
				set(aAtom, 1)
				run(innerTransaction)()
			},
		})
		const snapshots: number[][] = []

		subscribe(aAtom, () => snapshots.push([getState(aAtom), getState(bAtom)]))
		subscribe(bAtom, () => snapshots.push([getState(aAtom), getState(bAtom)]))
		runTransaction(outerTransaction)()

		expect(snapshots).toEqual([
			[1, 2],
			[1, 2],
		])
	})

	it(`settles the atom writes made through a writable selector`, () => {
		const firstAtom = atom<string>({ key: `first`, default: `old first` })
		const lastAtom = atom<string>({ key: `last`, default: `old last` })
		const fullNameSelector = selector<string>({
			key: `fullName`,
			get: ({ get }) => `${get(firstAtom)} ${get(lastAtom)}`,
			set: ({ set }, name: string) => {
				const [nextFirst, nextLast] = name.split(` `)
				set(firstAtom, nextFirst)
				set(lastAtom, nextLast)
			},
		})
		const renameTransaction = transaction<() => void>({
			key: `rename`,
			do: ({ set }) => {
				set(fullNameSelector, `new name`)
			},
		})
		const snapshots: string[][] = []

		subscribe(firstAtom, () =>
			snapshots.push([getState(firstAtom), getState(lastAtom)]),
		)
		subscribe(lastAtom, () =>
			snapshots.push([getState(firstAtom), getState(lastAtom)]),
		)
		runTransaction(renameTransaction)()

		expect(snapshots).toEqual([
			[`new`, `name`],
			[`new`, `name`],
		])
		expect(getState(fullNameSelector)).toBe(`new name`)
	})

	it(`retains one reversible timeline event`, () => {
		const aAtom = atom<number>({ key: `a`, default: 0 })
		const bAtom = atom<number>({ key: `b`, default: 0 })
		const historyTimeline = timeline({
			key: `history`,
			scope: [aAtom, bAtom],
		})
		const updateTransaction = transaction<() => void>({
			key: `update`,
			do: ({ set }) => {
				set(aAtom, 1)
				set(bAtom, 2)
			},
		})

		runTransaction(updateTransaction)()
		expect(inspectTimeline(historyTimeline)).toEqual({ at: 1, length: 1 })

		const snapshots: number[][] = []
		subscribe(aAtom, () => snapshots.push([getState(aAtom), getState(bAtom)]))
		subscribe(bAtom, () => snapshots.push([getState(aAtom), getState(bAtom)]))
		undo(historyTimeline)
		expect([getState(aAtom), getState(bAtom)]).toEqual([0, 0])
		expect(snapshots).toEqual([
			[0, 0],
			[0, 0],
		])
	})

	it(`does not notify when transaction construction fails`, () => {
		const aAtom = atom<number>({ key: `a`, default: 0 })
		const updateTransaction = transaction<() => void>({
			key: `update`,
			do: ({ set }) => {
				set(aAtom, 1)
				throw new Error(`no commit`)
			},
		})
		const subscriber = vitest.fn()

		subscribe(aAtom, subscriber)
		expect(() => {
			runTransaction(updateTransaction)()
		}).toThrow(`no commit`)

		expect(getState(aAtom)).toBe(0)
		expect(subscriber).not.toHaveBeenCalled()
	})

	it(`cancels deferred notifications when replay fails`, () => {
		const countAtom = atom<number>({ key: `count`, default: 0 })
		const replayTransaction = transaction<() => void>({
			key: `replay`,
			do: () => {},
		})
		const updates = vitest.fn()
		subscribe(countAtom, updates)
		const stopThrowing = Internal.IMPLICIT.STORE.on.moleculeCreation.subscribe(
			`throw-on-creation`,
			() => {
				throw new Error(`replay failed`)
			},
		)

		expect(() => {
			Internal.ingestTransactionOutcomeEvent(
				Internal.IMPLICIT.STORE,
				replayOutcome(replayTransaction, [
					{
						type: `atom_update`,
						token: countAtom,
						update: { oldValue: 0, newValue: 1 },
						timestamp: 0,
					},
					{
						type: `molecule_creation`,
						key: `failed-child`,
						provenance: `missing-parent`,
						timestamp: 0,
					},
				]),
				`newValue`,
			)
		}).toThrow(`replay failed`)
		stopThrowing()

		expect(updates).not.toHaveBeenCalled()
		setState(countAtom, 2)
		expect(updates).toHaveBeenCalledOnce()
		expect(updates).toHaveBeenCalledWith({ oldValue: 1, newValue: 2 })
	})

	it(`does not promote an intermediate value to the original value`, () => {
		const countAtom = atom<number>({ key: `count`, default: () => 0 })
		const replayTransaction = transaction<() => void>({
			key: `replay`,
			do: () => {},
		})
		const updates = vitest.fn()
		subscribe(countAtom, updates)

		Internal.ingestTransactionOutcomeEvent(
			Internal.IMPLICIT.STORE,
			replayOutcome(replayTransaction, [
				{
					type: `atom_update`,
					token: countAtom,
					update: { oldValue: 0, newValue: 1 },
					timestamp: 0,
				},
				{
					type: `atom_update`,
					token: countAtom,
					update: { oldValue: 1, newValue: 2 },
					timestamp: 0,
				},
			]),
			`newValue`,
		)

		expect(updates).toHaveBeenCalledOnce()
		expect(updates).toHaveBeenCalledWith({ newValue: 2 })
	})

	it(`finishes commit publication before rethrowing an observer error`, () => {
		const aAtom = atom<number>({ key: `a`, default: 0 })
		const bAtom = atom<number>({ key: `b`, default: 0 })
		const sumSelector = selector<number>({
			key: `sum`,
			get: ({ get }) => get(aAtom) + get(bAtom),
		})
		const updateTransaction = transaction<() => void>({
			key: `update`,
			do: ({ set }) => {
				set(aAtom, 1)
				set(bAtom, 2)
			},
		})
		const observerError = new Error(`observer failed`)
		const survivingAtomObserver = vitest.fn()
		const selectorObserver = vitest.fn()
		const transactionObserver = vitest.fn()

		subscribe(aAtom, () => {
			throw observerError
		})
		subscribe(aAtom, survivingAtomObserver)
		subscribe(sumSelector, selectorObserver)
		subscribe(updateTransaction, transactionObserver)

		let caught: unknown
		try {
			runTransaction(updateTransaction)()
		} catch (error) {
			caught = error
		}

		expect(caught).toBe(observerError)
		expect([getState(aAtom), getState(bAtom)]).toEqual([1, 2])
		expect(survivingAtomObserver).toHaveBeenCalledOnce()
		expect(selectorObserver).toHaveBeenCalledWith({ oldValue: 0, newValue: 3 })
		expect(transactionObserver).toHaveBeenCalledOnce()
	})

	it(`aggregates observer errors after commit publication`, () => {
		const aAtom = atom<number>({ key: `a`, default: 0 })
		const bAtom = atom<number>({ key: `b`, default: 0 })
		const updateTransaction = transaction<() => void>({
			key: `update`,
			do: ({ set }) => {
				set(aAtom, 1)
				set(bAtom, 2)
			},
		})
		const firstError = new Error(`first observer failed`)
		const secondError = new Error(`second observer failed`)
		const transactionObserver = vitest.fn()

		subscribe(aAtom, () => {
			throw firstError
		})
		subscribe(bAtom, () => {
			throw secondError
		})
		subscribe(updateTransaction, transactionObserver)

		let caught: unknown
		try {
			runTransaction(updateTransaction)()
		} catch (error) {
			caught = error
		}

		expect(caught).toBeInstanceOf(AggregateError)
		if (caught instanceof AggregateError) {
			expect(caught.errors).toEqual([firstError, secondError])
		}
		expect([getState(aAtom), getState(bAtom)]).toEqual([1, 2])
		expect(transactionObserver).toHaveBeenCalledOnce()
	})
})
