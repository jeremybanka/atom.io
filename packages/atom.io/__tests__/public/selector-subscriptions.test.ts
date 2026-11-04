import type { ReadonlyHeldSelectorOptions } from "atom.io"
import { Silo } from "atom.io"
import { describe, expect, it, vi } from "vitest"

function fixture() {
	const silo = new Silo({
		name: `selector-subscriptions`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	for (const logger of silo.store.loggers) logger.logLevel = null
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	return { silo, countAtom }
}

describe(`selector subscriptions`, () => {
	it.each([0, 1])(
		`keeps the other consumer subscribed when consumer %i unsubscribes`,
		(removed) => {
			const { silo, countAtom } = fixture()
			const compute = vi.fn((count: number) => count * 2)
			const doubledSelector = silo.selector<number>({
				key: `doubled`,
				get: ({ get }) => compute(get(countAtom)),
			})
			const consumers = [vi.fn(), vi.fn()]
			const stops = consumers.map((consumer) =>
				silo.subscribe(doubledSelector, consumer),
			)
			silo.setState(countAtom, 1)
			for (const consumer of consumers) {
				expect(consumer).toHaveBeenCalledExactlyOnceWith({
					oldValue: 0,
					newValue: 2,
				})
			}

			stops[removed]()
			stops[removed]()
			silo.setState(countAtom, 2)
			expect(consumers[removed]).toHaveBeenCalledTimes(1)
			expect(consumers[1 - removed]).toHaveBeenCalledTimes(2)
			expect(consumers[1 - removed]).toHaveBeenLastCalledWith({
				oldValue: 2,
				newValue: 4,
			})
			expect(compute).toHaveBeenCalledTimes(3)

			stops[1 - removed]()
			silo.setState(countAtom, 3)
			expect(compute).toHaveBeenCalledTimes(3)
			expect(silo.getState(doubledSelector)).toBe(6)
		},
	)

	it(`keeps a recreated family member subscribed when its old consumer leaves`, () => {
		const { silo, countAtom } = fixture()
		const doubledSelectors = silo.selectorFamily<number, string>({
			key: `doubled`,
			get:
				() =>
				({ get }) =>
					get(countAtom) * 2,
		})
		const originalSelector = silo.findState(doubledSelectors, `entry`)
		const stopOriginal = silo.subscribe(originalSelector, vi.fn())
		silo.disposeState(doubledSelectors, `entry`)
		const recreatedSelector = silo.findState(doubledSelectors, `entry`)
		const consume = vi.fn()
		const stopRecreated = silo.subscribe(recreatedSelector, consume)
		stopOriginal()
		silo.setState(countAtom, 1)
		expect(consume).toHaveBeenCalledExactlyOnceWith({
			oldValue: 0,
			newValue: 2,
		})
		stopRecreated()
	})

	it(`reconciles shared conditional roots before and after a consumer leaves`, () => {
		const { silo, countAtom } = fixture()
		const fallbackAtom = silo.atom<number>({ key: `fallback`, default: 10 })
		const useFallbackAtom = silo.atom<boolean>({
			key: `useFallback`,
			default: false,
		})
		const selectedSelector = silo.selector<number>({
			key: `selected`,
			get: ({ get }) =>
				get(useFallbackAtom) ? get(fallbackAtom) : get(countAtom),
		})
		const first = vi.fn()
		const second = vi.fn()
		const stopFirst = silo.subscribe(selectedSelector, first)
		const stopSecond = silo.subscribe(selectedSelector, second)

		silo.setState(useFallbackAtom, true)
		expect(first).toHaveBeenCalledTimes(1)
		expect(second).toHaveBeenCalledTimes(1)
		stopFirst()
		silo.setState(fallbackAtom, 20)
		silo.setState(countAtom, 1)
		silo.setState(useFallbackAtom, false)
		silo.setState(fallbackAtom, 30)
		silo.setState(countAtom, 2)
		expect(first).toHaveBeenCalledTimes(1)
		expect(second.mock.calls.map(([update]) => update.newValue)).toEqual([
			10, 20, 1, 2,
		])
		stopSecond()
	})

	it.each([false, true])(
		`notifies held selector consumers when a source changes (writable: %s)`,
		(writable) => {
			const { silo, countAtom } = fixture()
			const constant = { doubled: 0 }
			const compute = vi.fn((count: number) => {
				constant.doubled = count * 2
			})
			const options: ReadonlyHeldSelectorOptions<{ doubled: number }> = {
				key: `held`,
				const: constant,
				get: ({ get }) => {
					compute(get(countAtom))
				},
			}
			const heldSelector = writable
				? silo.selector<{ doubled: number }>({
						...options,
						set: ({ set }, value) => {
							set(countAtom, value.doubled / 2)
						},
					})
				: silo.selector<{ doubled: number }>(options)
			const first = vi.fn(({ newValue }) => newValue.doubled)
			const second = vi.fn(({ newValue }) => newValue.doubled)
			const stopFirst = silo.subscribe(heldSelector, first)
			const stopSecond = silo.subscribe(heldSelector, second)
			expect(compute).toHaveBeenCalledTimes(1)
			silo.setState(countAtom, 1)
			expect(first).toHaveReturnedWith(2)
			expect(second).toHaveReturnedWith(2)
			expect(second.mock.calls[0][0].newValue).toBe(constant)

			stopFirst()
			silo.setState(countAtom, 2)
			expect(first).toHaveBeenCalledTimes(1)
			expect(second).toHaveBeenCalledTimes(2)
			expect(second).toHaveLastReturnedWith(4)
			expect(silo.getState(heldSelector)).toBe(constant)
			stopSecond()
			silo.setState(countAtom, 3)
			expect(compute).toHaveBeenCalledTimes(3)
		},
	)

	it(`notifies a held selector once after a transaction settles its roots`, () => {
		const { silo, countAtom } = fixture()
		const otherAtom = silo.atom<number>({ key: `other`, default: 0 })
		const heldSelector = silo.selector<{ total: number }>({
			key: `held`,
			const: { total: 0 },
			get: ({ get }, value) => {
				value.total = get(countAtom) + get(otherAtom)
			},
		})
		const changeTransaction = silo.transaction<() => void>({
			key: `change`,
			do: ({ set }) => {
				set(countAtom, 1)
				set(otherAtom, 2)
			},
		})
		const consume = vi.fn(({ newValue }) => newValue.total)
		const stop = silo.subscribe(heldSelector, consume)
		silo.runTransaction(changeTransaction)()
		expect(consume).toHaveBeenCalledTimes(1)
		expect(consume).toHaveReturnedWith(3)
		stop()
	})
})
