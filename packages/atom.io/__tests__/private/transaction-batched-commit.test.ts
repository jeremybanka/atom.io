import type { TransactionOutcomeEvent } from "atom.io"
import {
	atom,
	atomFamily,
	findState,
	getState,
	inspectTimeline,
	mutableAtom,
	redo,
	runTransaction,
	selector,
	Silo,
	subscribe,
	timeline,
	transaction,
	undo,
} from "atom.io"
import * as Internal from "atom.io/internal"
import { setTestLogLevel, stateExists, takeSnapshot } from "atom.io/testing"
import { UList } from "atom.io/transceivers/u-list"
import { vitest } from "vitest"

const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	setTestLogLevel(null)
})

describe(`transaction commit strategies`, () => {
	it(`preserves playback commits as the default`, () => {
		const leftAtom = atom<number>({ key: `left`, default: 0 })
		const rightAtom = atom<number>({ key: `right`, default: 0 })
		const totalSelector = selector<number>({
			key: `total`,
			get: ({ get }) => get(leftAtom) + get(rightAtom),
		})
		const setBothTX = transaction<(value: number) => void>({
			key: `setBoth`,
			do: ({ set }, value) => {
				set(leftAtom, value)
				set(rightAtom, value)
			},
		})
		const selectorUpdates = vitest.fn()

		subscribe(totalSelector, selectorUpdates)
		runTransaction(setBothTX)(1)

		expect(selectorUpdates).toHaveBeenCalledTimes(2)
		expect(selectorUpdates.mock.calls).toEqual([
			[{ oldValue: 0, newValue: 1 }],
			[{ oldValue: 1, newValue: 2 }],
		])
	})

	it(`recomputes and notifies a shared selector once for a batched commit`, () => {
		const leftAtom = atom<number>({ key: `left`, default: 0 })
		const rightAtom = atom<number>({ key: `right`, default: 0 })
		let computations = 0
		const totalSelector = selector<number>({
			key: `total`,
			get: ({ get }) => {
				computations += 1
				return get(leftAtom) + get(rightAtom)
			},
		})
		const setBothTX = transaction<(value: number) => void>({
			key: `setBoth`,
			commit: `batched`,
			do: ({ set }, value) => {
				set(leftAtom, value)
				set(rightAtom, value)
			},
		})
		const selectorUpdates = vitest.fn()

		subscribe(totalSelector, selectorUpdates)
		expect(computations).toBe(1)

		runTransaction(setBothTX)(1)

		expect(selectorUpdates).toHaveBeenCalledTimes(1)
		expect(selectorUpdates).toHaveBeenCalledWith({
			oldValue: 0,
			newValue: 2,
		})
		expect(computations).toBe(2)
	})

	it(`makes every final sibling value visible before notifying atom subscribers`, () => {
		const leftAtom = atom<number>({ key: `left`, default: 0 })
		const rightAtom = atom<number>({ key: `right`, default: 0 })
		const setBothTX = transaction<() => void>({
			key: `setBoth`,
			commit: `batched`,
			do: ({ set }) => {
				set(leftAtom, 1)
				set(rightAtom, 2)
			},
		})
		const observedSnapshots: [left: number, right: number][] = []

		subscribe(leftAtom, () => {
			observedSnapshots.push([getState(leftAtom), getState(rightAtom)])
		})
		subscribe(rightAtom, () => {
			observedSnapshots.push([getState(leftAtom), getState(rightAtom)])
		})

		runTransaction(setBothTX)()

		expect(observedSnapshots).toEqual([
			[1, 2],
			[1, 2],
		])
	})

	it(`recomputes a dynamic selector from the final committed branch`, () => {
		const chooseRightAtom = atom<boolean>({ key: `chooseRight`, default: false })
		const leftAtom = atom<number>({ key: `left`, default: 1 })
		const rightAtom = atom<number>({ key: `right`, default: 10 })
		const selectedSelector = selector<number>({
			key: `selected`,
			get: ({ get }) => (get(chooseRightAtom) ? get(rightAtom) : get(leftAtom)),
		})
		const switchBranchTX = transaction<() => void>({
			key: `switchBranch`,
			commit: `batched`,
			do: ({ set }) => {
				set(rightAtom, 20)
				set(chooseRightAtom, true)
				set(leftAtom, 2)
			},
		})
		const selectorUpdates = vitest.fn()

		subscribe(selectedSelector, selectorUpdates)
		runTransaction(switchBranchTX)()

		expect(selectorUpdates).toHaveBeenCalledOnce()
		expect(selectorUpdates).toHaveBeenCalledWith({
			oldValue: 1,
			newValue: 20,
		})
	})

	it(`coalesces repeated atom notifications without rewriting subevent history`, () => {
		const countAtom = atom<number>({ key: `count`, default: 0 })
		const setCountTX = transaction<() => void>({
			key: `setCount`,
			commit: `batched`,
			do: ({ set }) => {
				set(countAtom, 1)
				set(countAtom, 2)
				set(countAtom, 3)
			},
		})
		const atomUpdates = vitest.fn()
		let outcome: TransactionOutcomeEvent<typeof setCountTX> | undefined

		subscribe(countAtom, atomUpdates)
		subscribe(setCountTX, (update) => {
			outcome = update
		})
		runTransaction(setCountTX)()

		expect(atomUpdates).toHaveBeenCalledTimes(1)
		expect(atomUpdates).toHaveBeenCalledWith({ oldValue: 0, newValue: 3 })
		expect(outcome?.subEvents.map((subEvent) => subEvent.type)).toEqual([
			`atom_update`,
			`atom_update`,
			`atom_update`,
		])
		expect(
			outcome?.subEvents.map((subEvent) =>
				subEvent.type === `atom_update` ? subEvent.update : null,
			),
		).toEqual([
			{ oldValue: 0, newValue: 1 },
			{ oldValue: 1, newValue: 2 },
			{ oldValue: 2, newValue: 3 },
		])
	})

	it(`batches nested atom-only transactions while retaining their event structure`, () => {
		const leftAtom = atom<number>({ key: `left`, default: 0 })
		const rightAtom = atom<number>({ key: `right`, default: 0 })
		const setRightTX = transaction<() => void>({
			key: `setRight`,
			do: ({ set }) => {
				set(rightAtom, 2)
			},
		})
		const setNestedTX = transaction<() => void>({
			key: `setNested`,
			commit: `batched`,
			do: ({ run, set }) => {
				set(leftAtom, 1)
				run(setRightTX)()
				set(leftAtom, 3)
			},
		})
		const leftUpdates = vitest.fn()
		const rightUpdates = vitest.fn()
		const observedSnapshots: [left: number, right: number][] = []
		let outcome: TransactionOutcomeEvent<typeof setNestedTX> | undefined

		subscribe(leftAtom, (update) => {
			leftUpdates(update)
			observedSnapshots.push([getState(leftAtom), getState(rightAtom)])
		})
		subscribe(rightAtom, (update) => {
			rightUpdates(update)
			observedSnapshots.push([getState(leftAtom), getState(rightAtom)])
		})
		subscribe(setNestedTX, (update) => {
			outcome = update
		})

		runTransaction(setNestedTX)()

		expect(leftUpdates).toHaveBeenCalledTimes(1)
		expect(leftUpdates).toHaveBeenCalledWith({ oldValue: 0, newValue: 3 })
		expect(rightUpdates).toHaveBeenCalledTimes(1)
		expect(rightUpdates).toHaveBeenCalledWith({ oldValue: 0, newValue: 2 })
		expect(observedSnapshots).toEqual([
			[3, 2],
			[3, 2],
		])
		expect(outcome?.subEvents.map((subEvent) => subEvent.type)).toEqual([
			`atom_update`,
			`transaction_outcome`,
			`atom_update`,
		])
		const nestedOutcome = outcome?.subEvents[1]
		expect(nestedOutcome?.type).toBe(`transaction_outcome`)
		if (nestedOutcome?.type === `transaction_outcome`) {
			expect(nestedOutcome.subEvents.map((subEvent) => subEvent.type)).toEqual([
				`atom_update`,
			])
		}
	})

	it(`rolls back without notifying atoms, selectors, or the transaction`, () => {
		const leftAtom = atom<number>({ key: `left`, default: 0 })
		const rightAtom = atom<number>({ key: `right`, default: 0 })
		let computations = 0
		const totalSelector = selector<number>({
			key: `total`,
			get: ({ get }) => {
				computations += 1
				return get(leftAtom) + get(rightAtom)
			},
		})
		const failingTX = transaction<() => void>({
			key: `failing`,
			commit: `batched`,
			do: ({ set }) => {
				set(leftAtom, 1)
				set(rightAtom, 2)
				throw new Error(`rollback`)
			},
		})
		const atomUpdates = vitest.fn()
		const selectorUpdates = vitest.fn()
		const transactionUpdates = vitest.fn()

		subscribe(leftAtom, atomUpdates)
		subscribe(totalSelector, selectorUpdates)
		subscribe(failingTX, transactionUpdates)
		expect(computations).toBe(1)

		expect(() => {
			runTransaction(failingTX)()
		}).toThrow(`rollback`)

		expect(getState(leftAtom)).toBe(0)
		expect(getState(rightAtom)).toBe(0)
		expect(getState(totalSelector)).toBe(0)
		expect(computations).toBe(1)
		expect(atomUpdates).not.toHaveBeenCalled()
		expect(selectorUpdates).not.toHaveBeenCalled()
		expect(transactionUpdates).not.toHaveBeenCalled()
	})

	it(`records a batched commit as one reversible timeline update`, () => {
		const leftAtom = atom<number>({ key: `left`, default: 0 })
		const rightAtom = atom<number>({ key: `right`, default: 0 })
		const pairTimeline = timeline({
			key: `pairTimeline`,
			scope: [leftAtom, rightAtom],
		})
		const setBothTX = transaction<() => void>({
			key: `setBoth`,
			commit: `batched`,
			do: ({ set }) => {
				set(leftAtom, 1)
				set(rightAtom, 2)
			},
		})

		runTransaction(setBothTX)()

		expect(inspectTimeline(pairTimeline)).toEqual({ at: 1, length: 1 })
		expect([getState(leftAtom), getState(rightAtom)]).toEqual([1, 2])

		undo(pairTimeline)
		expect([getState(leftAtom), getState(rightAtom)]).toEqual([0, 0])

		redo(pairTimeline)
		expect([getState(leftAtom), getState(rightAtom)]).toEqual([1, 2])
	})

	it(`falls back safely for lifecycle subevents`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const createCountTX = transaction<(key: string, value: number) => void>({
			key: `createCount`,
			commit: `batched`,
			do: ({ find, set }, key, value) => {
				set(find(countAtoms, key), value)
			},
		})
		let outcome: TransactionOutcomeEvent<typeof createCountTX> | undefined

		subscribe(createCountTX, (update) => {
			outcome = update
		})
		runTransaction(createCountTX)(`new`, 7)

		expect(stateExists(countAtoms, `new`)).toBe(true)
		expect(getState(findState(countAtoms, `new`))).toBe(7)
		expect(
			outcome?.subEvents.some((subEvent) => subEvent.type === `atom_creation`),
		).toBe(true)
	})

	it(`falls back when a nested transaction contains lifecycle events`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const createCountTX = transaction<() => void>({
			key: `createCount`,
			do: ({ find, set }) => {
				set(find(countAtoms, `nested`), 7)
			},
		})
		const createNestedTX = transaction<() => void>({
			key: `createNested`,
			commit: `batched`,
			do: ({ run }) => {
				run(createCountTX)()
			},
		})
		let outcome: TransactionOutcomeEvent<typeof createNestedTX> | undefined

		subscribe(createNestedTX, (update) => {
			outcome = update
		})
		runTransaction(createNestedTX)()

		expect(getState(findState(countAtoms, `nested`))).toBe(7)
		expect(outcome?.subEvents).toHaveLength(1)
		expect(outcome?.subEvents[0]?.type).toBe(`transaction_outcome`)
	})

	it(`falls back for mutable tracker commands without coalescing them`, () => {
		const listAtom = mutableAtom<UList<string>>({
			key: `list`,
			class: UList,
		})
		const tracker = new Internal.Tracker(listAtom, Internal.IMPLICIT.STORE)
		const updateListTX = transaction<() => void>({
			key: `updateList`,
			commit: `batched`,
			do: ({ set }) => {
				set(tracker.latestSignalToken, `0\u001F\u0003x`)
				set(tracker.latestSignalToken, `0\u001F\u0003y`)
			},
		})

		expect(getState(listAtom)).toEqual(new UList())
		runTransaction(updateListTX)()
		expect(getState(listAtom)).toEqual(new UList([`x`, `y`]))
	})

	it(`falls back while an affected selector has a pending value`, async () => {
		const leftAtom = atom<number>({ key: `left`, default: 0 })
		const rightAtom = atom<number>({ key: `right`, default: 0 })
		let resolvePending: () => void = () => {}
		const pending = new Promise<void>((resolve) => {
			resolvePending = resolve
		})
		const totalSelector = selector<Promise<number> | number>({
			key: `total`,
			get: async ({ get }) => {
				const total = get(leftAtom) + get(rightAtom)
				await pending
				return total
			},
		})
		const setBothTX = transaction<() => void>({
			key: `setBoth`,
			commit: `batched`,
			do: ({ set }) => {
				set(leftAtom, 1)
				set(rightAtom, 2)
			},
		})
		const observedRightValues: number[] = []

		subscribe(totalSelector, () => {})
		subscribe(leftAtom, () => {
			observedRightValues.push(getState(rightAtom))
		})
		runTransaction(setBothTX)()

		expect(observedRightValues).toEqual([0])
		resolvePending()
		await pending
		expect(await getState(totalSelector)).toBe(3)
	})

	it(`retains a transaction event that another store can ingest`, () => {
		const source = new Silo({
			name: `batched-event-source`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const destination = new Silo({
			name: `batched-event-destination`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const sourceLeftAtom = source.atom<number>({ key: `sourceLeft`, default: 0 })
		const sourceRightAtom = source.atom<number>({
			key: `sourceRight`,
			default: 0,
		})
		destination.install([sourceLeftAtom, sourceRightAtom], source.store)
		const setBothTX = source.transaction<() => void>({
			key: `setBoth`,
			commit: `batched`,
			do: ({ set }) => {
				set(sourceLeftAtom, 1)
				set(sourceRightAtom, 2)
			},
		})
		let outcome: TransactionOutcomeEvent<typeof setBothTX> | undefined

		source.subscribe(setBothTX, (update) => {
			outcome = update
		})
		source.runTransaction(setBothTX)()
		if (!outcome) throw new Error(`Expected a transaction outcome`)

		Internal.ingestTransactionOutcomeEvent(
			destination.store,
			outcome,
			`newValue`,
		)
		expect(destination.getState(sourceLeftAtom)).toBe(1)
		expect(destination.getState(sourceRightAtom)).toBe(2)
	})

	it(`cleans operation and batching state after a subscriber throws`, () => {
		const leftAtom = atom<number>({ key: `left`, default: 0 })
		const rightAtom = atom<number>({ key: `right`, default: 0 })
		const totalSelector = selector<number>({
			key: `total`,
			get: ({ get }) => get(leftAtom) + get(rightAtom),
		})
		const setBothTX = transaction<(left: number, right: number) => void>({
			key: `setBoth`,
			commit: `batched`,
			do: ({ set }, left, right) => {
				set(leftAtom, left)
				set(rightAtom, right)
			},
		})
		const unsubscribeThrowing = subscribe(leftAtom, () => {
			throw new Error(`subscriber failed`)
		})

		expect(() => {
			runTransaction(setBothTX)(1, 2)
		}).toThrow(`subscriber failed`)
		expect(Internal.IMPLICIT.STORE.operation.open).toBe(false)
		expect(Internal.IMPLICIT.STORE.on.transactionApplying.state).toBeNull()
		unsubscribeThrowing()

		const selectorUpdates = vitest.fn()
		subscribe(totalSelector, selectorUpdates)
		runTransaction(setBothTX)(3, 4)
		expect(selectorUpdates).toHaveBeenCalledOnce()
		expect(selectorUpdates).toHaveBeenCalledWith({
			oldValue: 3,
			newValue: 7,
		})
	})
})
