import { Silo } from "atom.io"
import { Future } from "atom.io/foundations/future"
import {
	createRegularAtom,
	getTimelineTransactionGroup,
	Tracker,
} from "atom.io/internal"
import {
	observeStore,
	peekDependencies,
	peekState,
	peekStateDefinition,
	type StoreChanges,
} from "atom.io/introspection"
import { UList } from "atom.io/transceivers/u-list"
import { expect, it, vi } from "vitest"

function setup() {
	const silo = new Silo({
		name: `observed`,
		isProduction: true,
		lifespan: `ephemeral`,
	})
	const { store } = silo
	store.loggers = []
	return { silo, store }
}

it(`reports cache and retained dependency changes without evaluating or subscribing to state`, async () => {
	const { silo, store } = setup()
	const defaultValue = vi.fn(() => undefined)
	const lazyAtom = silo.atom<undefined>({ key: `lazy`, default: defaultValue })
	const branchAtom = silo.atom<boolean>({ key: `branch`, default: true })
	const chooseSelector = silo.selector<undefined>({
		key: `choose`,
		get: ({ get }) => {
			if (get(branchAtom)) get(lazyAtom)
			return undefined
		},
	})
	const observe = vi.fn<(changes: StoreChanges) => void>()
	const stop = observeStore(store, observe)
	expect(peekState(store, lazyAtom.key)).toEqual({ present: false })
	expect(defaultValue).not.toHaveBeenCalled()
	expect(peekStateDefinition(store, lazyAtom.key)?.type).toBe(`atom`)
	expect(peekStateDefinition(store, chooseSelector.key)?.type).toBe(
		`readonly_pure_selector`,
	)
	expect(
		store.readonlySelectors.get(chooseSelector.key)?.subject.subscribers.size,
	).toBe(0)

	silo.getState(chooseSelector)
	expect(peekState(store, lazyAtom.key)).toEqual({
		present: true,
		value: undefined,
	})
	expect(observe).not.toHaveBeenCalled()
	await Promise.resolve()
	expect(observe).toHaveBeenLastCalledWith({
		values: new Set([`branch`, `lazy`, `choose`]),
		states: new Set(),
		families: new Set(),
		dependencies: new Set([`choose`]),
		futures: new Map(),
		timelines: new Set(),
		transactions: new Map(),
	})
	expect(defaultValue).toHaveBeenCalledTimes(1)
	expect(peekDependencies(store, chooseSelector.key, 1)).toMatchObject({
		dependencies: [`branch`],
		inspected: 1,
		total: 2,
	})

	silo.setState(branchAtom, false)
	expect(peekState(store, chooseSelector.key)).toEqual({ present: false })
	silo.getState(chooseSelector)
	await Promise.resolve()
	expect(observe.mock.lastCall?.[0].dependencies).toEqual(new Set([`choose`]))
	silo.setState(branchAtom, false)
	silo.getState(chooseSelector)
	await Promise.resolve()
	expect(observe.mock.lastCall?.[0].dependencies).toEqual(new Set())

	const exampleSelectors = silo.selectorFamily<number, string>({
		key: `example`,
		get: () => () => 0,
	})
	const member = silo.findState(exampleSelectors, `a`)
	silo.getState(member)
	const reservedAtom = createRegularAtom(
		store,
		{ key: `🔍 reserved`, default: 5 },
		undefined,
	)
	silo.setState(reservedAtom, 6)
	await Promise.resolve()
	expect(observe.mock.lastCall?.[0]).toMatchObject({
		values: new Set([member.key]),
		states: new Set([member.key]),
		families: new Set([exampleSelectors.key]),
	})
	silo.disposeState(exampleSelectors, `a`)
	await Promise.resolve()
	expect(observe.mock.lastCall?.[0].states).toEqual(new Set([member.key]))
	expect(peekState(store, member.key)).toEqual({ present: false })
	observe.mockClear()
	silo.setState(branchAtom, true)
	stop()
	await Promise.resolve()
	expect(observe).not.toHaveBeenCalled()
})

it(`batches owner history changes without subscribing to history subjects`, async () => {
	const { silo, store } = setup()
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	silo.getState(countAtom)
	const observe = vi.fn<(changes: StoreChanges) => void>()
	const stop = observeStore(store, observe)
	try {
		const countTimeline = silo.timeline({ key: `count`, scope: [countAtom] })
		const originalTransaction = silo.transaction({
			key: `original`,
			do: ({ set }) => {
				set(countAtom, 1)
				return 1
			},
		})
		silo.runTransaction(originalTransaction)()
		const replacementTransaction = silo.transaction({
			// eslint-disable-next-line atom.io/naming-convention -- replace the registered transaction
			key: originalTransaction.key,
			do: () => 2,
		})
		silo.runTransaction(replacementTransaction)()
		await Promise.resolve()
		expect(observe).toHaveBeenCalledOnce()
		expect(observe.mock.lastCall?.[0].timelines).toEqual(
			new Set([countTimeline.key]),
		)
		expect(observe.mock.lastCall?.[0].timelineDefinitions).toEqual(
			new Set([countTimeline.key]),
		)
		expect(
			observe.mock.lastCall?.[0].transactions.get(originalTransaction.key),
		).toMatchObject({
			registeredAt: 1,
			outcomes: [{ output: 1 }, { output: 2 }],
		})
		expect(
			store.timelines.get(countTimeline.key)?.subject.subscribers.size,
		).toBe(0)
		expect(
			store.transactions.get(originalTransaction.key)?.subject.subscribers.size,
		).toBe(0)

		silo.runTransaction(replacementTransaction)()
		silo.undo(countTimeline)
		await Promise.resolve()
		expect(observe.mock.lastCall?.[0].timelineDefinitions).toBeUndefined()
		expect(
			observe.mock.lastCall?.[0].transactions.get(originalTransaction.key),
		).toMatchObject({
			registeredAt: undefined,
			outcomes: [{ output: 2 }],
		})
		expect(observe.mock.lastCall?.[0].timelines).toEqual(
			new Set([countTimeline.key]),
		)
		silo.redo(countTimeline)
		silo.clearTimeline(countTimeline)
		silo.disposeTimeline(countTimeline)
		await Promise.resolve()
		expect(observe.mock.lastCall?.[0].timelines).toEqual(
			new Set([countTimeline.key]),
		)
		expect(store.timelines.has(countTimeline.key)).toBe(false)
	} finally {
		stop()
	}
})

it(`reports timeline family registrations independently of timeline members`, async () => {
	const { silo, store } = setup()
	const observe = vi.fn<(changes: StoreChanges) => void>()
	const stop = observeStore(store, observe)
	const historyTimelines = silo.timelineFamily<string>({
		key: `history`,
		scope: [],
	})
	silo.timelineFamily<string>({ key: `🔍 private`, scope: [] })
	await Promise.resolve()
	expect(observe).toHaveBeenCalledOnce()
	expect(observe.mock.lastCall?.[0]).toMatchObject({
		timelineFamilies: new Set([historyTimelines.key]),
		timelines: new Set(),
	})
	stop()
})

it(`correlates each committed outcome with its timeline copy even when callers reuse an id`, async () => {
	const { silo, store } = setup()
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	silo.getState(countAtom)
	const countTimeline = silo.timeline({ key: `count`, scope: [countAtom] })
	const saveTransaction = silo.transaction({
		key: `save`,
		do: ({ set }, value: number) => {
			set(countAtom, value)
		},
	})
	const unrelatedTransaction = silo.transaction({
		key: `unrelated`,
		do: () => {},
	})
	const observe = vi.fn<(changes: StoreChanges) => void>()
	const stop = observeStore(store, observe)
	const run = silo.runTransaction(saveTransaction, `shared`)
	run(1)
	run(2)
	silo.runTransaction(unrelatedTransaction)()
	await Promise.resolve()
	const changes = observe.mock.lastCall![0].transactions
	const committed = changes.get(saveTransaction.key)!.outcomes
	const recorded = store.timelines.get(countTimeline.key)!.history
	const sequences = committed.map(
		(event) => getTimelineTransactionGroup(event)?.sequence,
	)
	expect(sequences).toEqual([expect.any(Number), expect.any(Number)])
	expect(sequences[0]).not.toBe(sequences[1])
	for (const [index, event] of recorded.entries()) {
		expect(event.type).toBe(`transaction_outcome`)
		expect(getTimelineTransactionGroup(event)?.sequence).toBe(sequences[index])
	}
	expect(
		getTimelineTransactionGroup(
			changes.get(unrelatedTransaction.key)!.outcomes[0],
		),
	).toBeUndefined()
	stop()
})

it(`attributes nested writes to committed definitions and maps tracker signals to their atoms`, async () => {
	const { silo, store } = setup()
	const itemsAtom = silo.mutableAtom<UList<string>>({
		key: `items`,
		class: UList,
	})
	const flagAtom = silo.atom<boolean>({ key: `flag`, default: false })
	const { latestSignalToken } = new Tracker(itemsAtom, store)
	const privateAtom = createRegularAtom(
		store,
		{ key: `🔍 private`, default: 0 },
		undefined,
	)
	const childTransaction = silo.transaction({
		key: `child`,
		do: ({ set }) => {
			set(latestSignalToken, `0\u001F\u0003x`)
			set(privateAtom, 1)
		},
	})
	const hiddenTransaction = silo.transaction({
		// eslint-disable-next-line atom.io/naming-convention -- exercise the reserved introspection prefix
		key: `🔍 hidden`,
		do: ({ run }) => {
			run(childTransaction)()
		},
	})
	const parentTransaction = silo.transaction({
		key: `parent`,
		do: ({ run }) => {
			const draftTransaction = silo.transaction({
				key: `draft`,
				do: ({ set }) => {
					set(flagAtom, true)
				},
			})
			run(draftTransaction)()
			run(hiddenTransaction)()
		},
	})
	const observe = vi.fn<(changes: StoreChanges) => void>()
	const stop = observeStore(store, observe)
	silo.runTransaction(parentTransaction)()
	await Promise.resolve()
	expect(store.transactions.get(childTransaction.key)?.observedWrites).toEqual({
		keys: new Set([itemsAtom.key]),
		truncated: false,
	})
	expect(store.transactions.get(parentTransaction.key)?.observedWrites).toEqual({
		keys: new Set([flagAtom.key, itemsAtom.key]),
		truncated: false,
	})
	expect(
		store.transactions.get(hiddenTransaction.key)?.observedWrites,
	).toBeUndefined()
	expect(store.transactions.has(`draft`)).toBe(false)
	expect(observe.mock.lastCall?.[0].transactionWrites).toEqual(
		new Set([parentTransaction.key, childTransaction.key]),
	)
	stop()
})

it(`retains the first thousand distinct write keys and publishes truncation once`, async () => {
	const { silo, store } = setup()
	const entriesAtoms = silo.atomFamily<number, number>({
		key: `entries`,
		default: 0,
	})
	const entries = Array.from({ length: 1_003 }, (_, index) =>
		silo.findState(entriesAtoms, index),
	)
	for (const entry of entries) silo.getState(entry)
	const saveTransaction = silo.transaction({
		key: `save`,
		do: ({ set }, start: number, end: number) => {
			for (const entry of entries.slice(start, end))
				set(entry, (value) => value + 1)
		},
	})
	const observe = vi.fn<(changes: StoreChanges) => void>()
	const stop = observeStore(store, observe)
	silo.runTransaction(saveTransaction)(0, 1_000)
	await Promise.resolve()
	const writes = store.transactions.get(saveTransaction.key)?.observedWrites
	expect(writes).toEqual({
		keys: new Set(entries.slice(0, 1_000).map(({ key }) => key)),
		truncated: false,
	})
	silo.runTransaction(saveTransaction)(1_000, 1_002)
	await Promise.resolve()
	expect(writes).toMatchObject({ truncated: true })
	expect(writes?.keys.size).toBe(1_000)
	expect(observe.mock.lastCall?.[0].transactionWrites).toEqual(
		new Set([saveTransaction.key]),
	)
	silo.runTransaction(saveTransaction)(1_002, 1_003)
	await Promise.resolve()
	expect(observe.mock.lastCall?.[0].transactionWrites).toBeUndefined()
	silo.disposeState(entriesAtoms, 0)
	await Promise.resolve()
	expect(writes?.keys.has(entries[0].key)).toBe(false)
	expect(writes?.truncated).toBe(false)
	expect(observe.mock.lastCall?.[0].transactionWrites).toEqual(
		new Set([saveTransaction.key]),
	)
	silo.runTransaction(saveTransaction)(1_002, 1_003)
	await Promise.resolve()
	expect(writes?.keys.has(entries[1_002].key)).toBe(true)
	expect(writes?.keys.size).toBe(1_000)
	stop()
})

it(`leaves family-member creation out of observed transaction writes`, () => {
	const { silo, store } = setup()
	const itemsAtoms = silo.atomFamily<number, string>({
		key: `items`,
		default: 0,
	})
	const initializeTransaction = silo.transaction({
		key: `initialize`,
		do: ({ get }) => get(itemsAtoms, `member`),
	})
	const stop = observeStore(store, () => {})
	expect(silo.runTransaction(initializeTransaction)()).toBe(0)
	expect(store.atoms.has(silo.findState(itemsAtoms, `member`).key)).toBe(true)
	expect(
		store.transactions.get(initializeTransaction.key)?.observedWrites,
	).toBeUndefined()
	stop()
})

it(`marks all open transaction frames when write inspection hits its event limit`, () => {
	const { silo, store } = setup()
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const repeatTransaction = silo.transaction({
		key: `repeat`,
		do: ({ set }) => {
			for (let count = 1; count <= 10_001; count++) set(countAtom, count)
		},
	})
	const outerTransaction = silo.transaction({
		key: `outer`,
		do: ({ run }) => {
			run(repeatTransaction)()
		},
	})
	silo.runTransaction(outerTransaction)()
	expect(
		store.transactions.get(outerTransaction.key)?.observedWrites,
	).toBeUndefined()
	const stop = observeStore(store, () => {})
	silo.runTransaction(outerTransaction)()
	expect(silo.getState(countAtom)).toBe(10_001)
	for (const { key } of [repeatTransaction, outerTransaction]) {
		expect(store.transactions.get(key)?.observedWrites).toEqual({
			keys: new Set([countAtom.key]),
			truncated: true,
		})
	}
	stop()
})

it(`observes root transaction results and async completion without exposing draft values`, async () => {
	const { silo, store } = setup()
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	silo.getState(countAtom)
	const seen: unknown[] = []
	const stop = observeStore(store, ({ values }) => {
		for (const key of values) seen.push([key, peekState(store, key).value])
	})
	const actionTransaction = silo.transaction({
		key: `action`,
		do: ({ set }, abort: boolean) => {
			set(countAtom, 1)
			expect(peekState(store, countAtom.key).value).toBe(0)
			set(countAtom, 2)
			if (abort) throw new Error(`aborted`)
		},
	})
	expect(() => silo.runTransaction(actionTransaction)(true)).toThrow(`aborted`)
	await Promise.resolve()
	expect(seen).toEqual([])
	silo.runTransaction(actionTransaction)(false)
	await Promise.resolve()
	expect(seen).toEqual([[`count`, 2]])

	let resolve!: () => void
	const gate = new Promise<void>((done) => {
		resolve = done
	})
	const quoteSelector = silo.selector<Promise<number>>({
		key: `quote`,
		get: async ({ get }) => {
			await gate
			return get(countAtom) * 10
		},
	})
	const observe = vi.fn<(changes: StoreChanges) => void>()
	const stopQuote = observeStore(store, observe)
	const pending = silo.getState(quoteSelector)
	await Promise.resolve()
	expect(peekState(store, quoteSelector.key).value).toBe(pending)
	expect(observe.mock.lastCall?.[0].futures.get(quoteSelector.key)).toEqual(
		new Set([`started`]),
	)
	resolve()
	await pending
	await Promise.resolve()
	expect(
		observe.mock.calls.some(([changes]) =>
			changes.dependencies.has(quoteSelector.key),
		),
	).toBe(true)
	expect(seen.at(-1)).toEqual([`quote`, 20])
	expect(observe.mock.lastCall?.[0].futures.get(quoteSelector.key)).toEqual(
		new Set([`resolved`]),
	)
	stopQuote()
	stop()
})

it(`reports a cached Future's replacement without changing its identity`, async () => {
	const { silo, store } = setup()
	const request = Promise.withResolvers<number>()
	const replyAtom = silo.atom<Promise<number>>({
		key: `reply`,
		default: () => request.promise,
	})
	const observe = vi.fn<(changes: StoreChanges) => void>()
	const stop = observeStore(store, observe)
	const pending = silo.getState(replyAtom) as Future<number>
	await Promise.resolve()
	expect(pending).toBeInstanceOf(Future)
	const replacement = Promise.withResolvers<number>()
	pending.use(replacement.promise)
	await Promise.resolve()
	expect(observe.mock.lastCall?.[0].futures.get(replyAtom.key)).toEqual(
		new Set([`replaced`]),
	)
	expect(peekState(store, replyAtom.key).value).toBe(pending)
	request.resolve(1)
	replacement.resolve(2)
	await expect(pending).resolves.toBe(2)
	stop()
})

it(`reports the removed selector's incoming and outgoing dependencies on disposal`, async () => {
	const { silo, store } = setup()
	const countAtom = silo.atom<number>({ key: `count`, default: 3 })
	const doubleSelectors = silo.selectorFamily<number, string>({
		key: `double`,
		get:
			() =>
			({ get }) =>
				get(countAtom) * 2,
	})
	const doubleSelector = silo.findState(doubleSelectors, `a`)
	const totalSelector = silo.selector<number>({
		key: `total`,
		get: ({ get }) => get(doubleSelector) + 1,
	})
	expect(silo.getState(totalSelector)).toBe(7)
	const observe = vi.fn<(changes: StoreChanges) => void>()
	const stop = observeStore(store, observe)
	silo.disposeState(doubleSelectors, `a`)
	await Promise.resolve()
	expect(observe.mock.lastCall?.[0]).toMatchObject({
		states: new Set([doubleSelector.key]),
		dependencies: new Set([doubleSelector.key, totalSelector.key]),
	})
	stop()
})

it(`skips a listener removed by an earlier listener in the same batch`, async () => {
	const { silo, store } = setup()
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const stop = observeStore(store, () => {
		stopLater()
	})
	const later = vi.fn()
	const stopLater = observeStore(store, later)
	silo.setState(countAtom, 1)
	await Promise.resolve()
	expect(later).not.toHaveBeenCalled()
	stop()
})

it(`reports rejection of the current Future and ignores changes to a displaced Future`, async () => {
	const { silo, store } = setup()
	const replyAtom = silo.atom<number | Promise<number>>({
		key: `reply`,
		default: 0,
	})
	const observe = vi.fn<(changes: StoreChanges) => void>()
	const stop = observeStore(store, observe)
	const request = Promise.withResolvers<number>()
	silo.setState(replyAtom, request.promise)
	const displaced = silo.getState(replyAtom) as Future<number>
	silo.setState(replyAtom, 42)
	await Promise.resolve()
	observe.mockClear()
	const replacement = Promise.withResolvers<number>()
	displaced.use(replacement.promise)
	replacement.reject(new Error(`displaced request`))
	await expect(displaced).rejects.toThrow(`displaced request`)
	await Promise.resolve()
	expect(observe).not.toHaveBeenCalled()
	expect(peekState(store, replyAtom.key)).toEqual({ present: true, value: 42 })
	request.resolve(1)

	const active = Promise.withResolvers<number>()
	silo.setState(replyAtom, active.promise)
	const pending = silo.getState(replyAtom)
	await Promise.resolve()
	active.reject(new Error(`current request`))
	await expect(pending).rejects.toThrow(`current request`)
	await Promise.resolve()
	expect(observe.mock.lastCall?.[0].futures.get(replyAtom.key)).toEqual(
		new Set([`rejected`]),
	)
	stop()
})
