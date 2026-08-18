import type {
	Loadable,
	TransactionCommitEvent,
	TransactionCommitStateSnapshot,
	TransactionOutcomeEvent,
	TransactionToken,
} from "atom.io"
import {
	atom,
	findState,
	getState,
	inspectTimeline,
	mutableAtom,
	mutableAtomFamily,
	redo,
	runTransaction,
	selector,
	setState,
	subscribe,
	timeline,
	transaction,
	undo,
} from "atom.io"
import * as Internal from "atom.io/internal"
import { mosaicText } from "atom.io/realtime"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"
import { UList } from "atom.io/transceivers/u-list"
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

	it(`commits a mutable JSON snapshot with ordinary atom writes`, () => {
		const Text = mosaicText({ initialText: `old` })
		const textAtom = mutableAtom<InstanceType<typeof Text>>({
			class: Text,
			key: `text`,
		})
		const countAtom = atom<number>({ default: 0, key: `count` })
		const summarySelector = selector<string>({
			get: ({ get }) => `${get(textAtom).text}:${get(countAtom)}`,
			key: `summary`,
		})
		const replacement = new Text()
		replacement.change(
			{ text: `new`, type: `replace-text` },
			{
				actor: `test`,
				dependencies: [],
				group: `replace`,
				id: `replace`,
				now: 0,
				revision: null,
				session: `test`,
			},
		)
		const replaceTransaction = transaction<() => void>({
			do: ({ json, set }) => {
				set(json(textAtom), replacement.toJSON())
				set(countAtom, 1)
			},
			key: `replace`,
		})
		const summaries = vitest.fn()
		let outcome: TransactionOutcomeEvent<typeof replaceTransaction> | undefined

		subscribe(summarySelector, summaries)
		expect(getState(summarySelector)).toBe(`old:0`)
		subscribe(replaceTransaction, (event) => {
			outcome = event
		})
		runTransaction(replaceTransaction)()

		expect(getState(summarySelector)).toBe(`new:1`)
		expect(summaries).toHaveBeenCalledOnce()
		expect(summaries).toHaveBeenCalledWith({
			newValue: `new:1`,
			oldValue: `old:0`,
		})
		expect(outcome?.subEvents.map(({ type }) => type)).toEqual([
			`mutable_atom_snapshot`,
			`atom_update`,
		])

		const abortTransaction = transaction<() => void>({
			do: ({ json, set }) => {
				set(json(textAtom), new Text().toJSON())
				set(countAtom, 2)
				throw new Error(`abort snapshot`)
			},
			key: `abort`,
		})
		summaries.mockClear()
		expect(() => {
			runTransaction(abortTransaction)()
		}).toThrow(`abort snapshot`)
		expect(getState(summarySelector)).toBe(`new:1`)
		expect(summaries).not.toHaveBeenCalled()
	})

	it(`nests mutable snapshots under one reversible outer boundary`, () => {
		const itemsAtom = mutableAtom<UList<string>>({
			class: UList,
			key: `items`,
		})
		const countAtom = atom<number>({ default: 0, key: `count` })
		const summarySelector = selector<string>({
			get: ({ get }) => `${[...get(itemsAtom)].join(`,`)}:${get(countAtom)}`,
			key: `summary`,
		})
		const innerTransaction = transaction<() => void>({
			do: ({ json, set }) => {
				set(json(itemsAtom), [`intermediate`])
			},
			key: `inner`,
		})
		const outerTransaction = transaction<() => void>({
			do: ({ json, run, set }) => {
				run(innerTransaction)()
				set(json(itemsAtom), [`final`])
				set(countAtom, 1)
			},
			key: `outer`,
		})
		const historyTimeline = timeline({
			key: `history`,
			scope: [itemsAtom, countAtom],
		})
		const summaries = vitest.fn()
		let outcome: TransactionOutcomeEvent<typeof outerTransaction> | undefined
		subscribe(summarySelector, summaries)
		subscribe(outerTransaction, (event) => {
			outcome = event
		})

		runTransaction(outerTransaction)()

		expect(getState(summarySelector)).toBe(`final:1`)
		expect(summaries).toHaveBeenCalledOnce()
		expect(outcome?.subEvents.map(({ type }) => type)).toEqual([
			`transaction_outcome`,
			`mutable_atom_snapshot`,
			`atom_update`,
		])
		expect(
			outcome?.subEvents[0]?.type === `transaction_outcome`
				? outcome.subEvents[0].subEvents.map(({ type }) => type)
				: [],
		).toEqual([`mutable_atom_snapshot`])
		expect(inspectTimeline(historyTimeline)).toEqual({ at: 1, length: 1 })

		summaries.mockClear()
		undo(historyTimeline)
		expect(getState(summarySelector)).toBe(`:0`)
		expect(summaries).toHaveBeenCalledOnce()

		summaries.mockClear()
		redo(historyTimeline)
		expect(getState(summarySelector)).toBe(`final:1`)
		expect(summaries).toHaveBeenCalledOnce()

		const abortOuterTransaction = transaction<() => void>({
			do: ({ run }) => {
				run(innerTransaction)()
				throw new Error(`abort outer snapshot`)
			},
			key: `abortOuter`,
		})
		summaries.mockClear()
		expect(() => {
			runTransaction(abortOuterTransaction)()
		}).toThrow(`abort outer snapshot`)
		expect(getState(summarySelector)).toBe(`final:1`)
		expect(summaries).not.toHaveBeenCalled()
		expect(inspectTimeline(historyTimeline)).toEqual({ at: 1, length: 1 })
	})

	it(`captures mutable JSON event payloads before caller mutation`, () => {
		const itemsAtom = mutableAtom<UList<string>>({
			class: UList,
			key: `items`,
		})
		const payload = [`captured`]
		const replaceTransaction = transaction<() => void>({
			do: ({ json, set }) => {
				set(json(itemsAtom), payload)
				payload.push(`mutated-after-set`)
			},
			key: `replace`,
		})
		let outcome: TransactionOutcomeEvent<typeof replaceTransaction> | undefined
		subscribe(replaceTransaction, (event) => {
			outcome = event
		})

		runTransaction(replaceTransaction)()

		expect([...getState(itemsAtom)]).toEqual([`captured`])
		expect(
			outcome?.subEvents[0]?.type === `mutable_atom_snapshot`
				? outcome.subEvents[0].update.newValue
				: null,
		).toEqual([`captured`])
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
		const commitsBefore = Internal.transactionCommitCount(
			Internal.IMPLICIT.STORE,
		)
		expect(() => {
			runTransaction(updateTransaction)()
		}).toThrow(`no commit`)

		expect(getState(aAtom)).toBe(0)
		expect(subscriber).not.toHaveBeenCalled()
		expect(Internal.transactionCommitCount(Internal.IMPLICIT.STORE)).toBe(
			commitsBefore,
		)
	})

	it(`publishes one isolated outer commit and stays silent for aborted work`, () => {
		const aAtom = atom<number>({ key: `a`, default: 0 })
		const bAtom = atom<number>({ key: `b`, default: 0 })
		const innerTransaction = transaction<() => void>({
			key: `inner`,
			do: ({ set }) => {
				set(aAtom, 1)
			},
		})
		const outerTransaction = transaction<() => void>({
			key: `outer`,
			do: ({ run, set }) => {
				run(innerTransaction)()
				set(bAtom, 2)
			},
		})
		const abortingTransaction = transaction<() => void>({
			key: `aborting`,
			do: ({ run }) => {
				run(innerTransaction)()
				throw new Error(`abort outer`)
			},
		})
		const commits = vitest.fn()
		const unsubscribe = Internal.IMPLICIT.STORE.on.transactionCommit.subscribe(
			`test-commit-lifecycle`,
			commits,
		)

		runTransaction(outerTransaction, `outer-id`)()
		expect(() => {
			runTransaction(abortingTransaction)()
		}).toThrow(`abort outer`)
		runTransaction(outerTransaction, `outer-id-2`)()

		expect(commits).toHaveBeenCalledTimes(2)
		const commit = commits.mock.calls[0]?.[0]
		const nextCommit = commits.mock.calls[1]?.[0]
		expect(commit).toMatchObject({
			outcome: { id: `outer-id`, token: outerTransaction },
			type: `transaction_commit`,
		})
		expect(commit.sequence).toBeGreaterThan(0)
		expect(nextCommit.sequence).toBe(commit.sequence + 1)
		expect(Object.isFrozen(commit)).toBe(true)
		expect(Object.isFrozen(commit.outcome)).toBe(true)
		expect(Object.isFrozen(commit.outcome.subEvents)).toBe(true)
		expect(
			commit.outcome.subEvents.map(({ type }: { type: string }) => type),
		).toEqual([`transaction_outcome`, `atom_update`])
		expect([getState(aAtom), getState(bAtom)]).toEqual([1, 2])
		unsubscribe()
	})

	it(`isolates cyclic values and reports uncloneable values explicitly`, () => {
		type Cyclic = { label: string; self?: Cyclic }
		const cyclicAtom = atom<Cyclic>({
			default: { label: `old` },
			key: `cyclic`,
		})
		const updateTransaction = transaction<
			(callback: () => void, mutable: Map<string, string>) => () => void
		>({
			do: ({ set }, callback) => {
				const cyclic: Cyclic = { label: `new` }
				cyclic.self = cyclic
				set(cyclicAtom, cyclic)
				return callback
			},
			key: `update`,
		})
		let commit: TransactionCommitEvent | null = null
		const stateObserver = vitest.fn()
		const unsubscribe = Internal.IMPLICIT.STORE.on.transactionCommit.subscribe(
			`cyclic-commit-lifecycle`,
			(event) => {
				commit = event
			},
		)
		subscribe(cyclicAtom, stateObserver)
		const callback = () => undefined
		const mutable = new Map([[`mutable`, `container`]])

		expect(runTransaction(updateTransaction)(callback, mutable)).toBe(callback)

		expect(stateObserver).toHaveBeenCalledOnce()
		expect(commit).not.toBeNull()
		const published = commit!
		expect(published.isolationFailures.map(({ path }) => path)).toEqual([
			`outcome.output`,
			`outcome.params[0]`,
			`outcome.params[1]`,
		])
		expect(published.outcome.output).toMatchObject({
			type: `transaction_commit_uncloneable`,
		})
		expect(published.outcome.params[0]).toMatchObject({
			type: `transaction_commit_uncloneable`,
		})
		expect(published.outcome.params[1]).toMatchObject({
			type: `transaction_commit_uncloneable`,
		})
		const snapshot = published.snapshots[0]
		const isolated = snapshot.newValue as Cyclic
		expect(isolated.self).toBe(isolated)
		expect(Object.isFrozen(isolated)).toBe(true)
		expect(Object.isFrozen(getState(cyclicAtom))).toBe(false)
		unsubscribe()
	})

	it(`distinguishes star-prefixed atoms from transceiver family trackers`, () => {
		// eslint-disable-next-line atom.io/naming-convention -- exercises a legal key that resembles the internal tracker prefix
		const ordinaryAtom = atom<number>({ default: 0, key: `*ordinary` })
		const listAtoms = mutableAtomFamily<UList<string>, string>({
			class: UList,
			key: `list`,
		})
		const listAtom = findState(listAtoms, `a`)
		getState(listAtom)
		const updateTransaction = transaction<() => void>({
			do: ({ set }) => {
				set(ordinaryAtom, 1)
				set(listAtom, (list) => list.add(`x`))
			},
			key: `update`,
		})
		let snapshots: readonly TransactionCommitStateSnapshot[] = []
		const unsubscribe = Internal.IMPLICIT.STORE.on.transactionCommit.subscribe(
			`tracker-snapshot-lifecycle`,
			(event) => {
				snapshots = event.snapshots
			},
		)

		runTransaction(updateTransaction)()

		const ordinary = snapshots.find(
			({ token }) => token.key === ordinaryAtom.key,
		)
		const list = snapshots.find(({ token }) => token.key === listAtom.key)
		expect(ordinary).toMatchObject({
			newExists: true,
			newValue: 1,
			oldExists: true,
			oldValue: 0,
		})
		expect(list).toMatchObject({
			newExists: true,
			newValue: [`x`],
			oldExists: true,
			oldValue: [],
			token: { family: listAtom.family, key: listAtom.key },
		})
		unsubscribe()
	})

	it(`does not let a commit listener failure hide a committed outcome`, () => {
		const countAtom = atom<number>({ key: `count`, default: 0 })
		const updateTransaction = transaction<() => void>({
			key: `update`,
			do: ({ set }) => {
				set(countAtom, 1)
			},
		})
		const stateObserver = vitest.fn()
		const observerError = new Error(`commit listener failed`)
		const unsubscribe = Internal.IMPLICIT.STORE.on.transactionCommit.subscribe(
			`throwing-commit-listener`,
			() => {
				throw observerError
			},
		)
		subscribe(countAtom, stateObserver)

		expect(() => {
			runTransaction(updateTransaction)()
		}).toThrow(observerError)

		expect(getState(countAtom)).toBe(1)
		expect(stateObserver).toHaveBeenCalledWith({ oldValue: 0, newValue: 1 })
		unsubscribe()
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
		const commitsBefore = Internal.transactionCommitCount(
			Internal.IMPLICIT.STORE,
		)
		try {
			runTransaction(updateTransaction)()
		} catch (error) {
			caught = error
		}

		expect(caught).toBe(observerError)
		expect(Internal.transactionCommitCount(Internal.IMPLICIT.STORE)).toBe(
			commitsBefore + 1,
		)
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
