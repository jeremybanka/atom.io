import { Silo } from "atom.io"
import { createRegularAtom } from "atom.io/internal"
import {
	observeStore,
	peekState,
	type StoreChanges,
} from "atom.io/introspection"
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
	})
	expect(defaultValue).toHaveBeenCalledTimes(1)

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
	resolve()
	await pending
	await Promise.resolve()
	expect(
		observe.mock.calls.some(([changes]) =>
			changes.dependencies.has(quoteSelector.key),
		),
	).toBe(true)
	expect(seen.at(-1)).toEqual([`quote`, 20])
	stopQuote()
	stop()
})
