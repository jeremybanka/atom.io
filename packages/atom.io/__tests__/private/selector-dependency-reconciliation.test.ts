import { Silo } from "atom.io"
import * as Internal from "atom.io/internal"
import { vitest } from "vitest"

function makeSilo(name: string): Silo {
	const silo = new Silo({
		name: `test/selector-dependency-reconciliation/${name}`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	silo.store.loggers[0].logLevel = null
	return silo
}

describe(`selector dependency reconciliation`, () => {
	it(`does not rewrite stable selector dependencies during recomputation`, () => {
		const silo = makeSilo(`stable`)
		const rootAtom = silo.atom<number>({
			key: `root`,
			default: 0,
		})
		const innerSelector = silo.selector<number>({
			key: `inner`,
			get: ({ get }) => get(rootAtom) + 1,
		})
		const outerSelector = silo.selector<number>({
			key: `outer`,
			get: ({ get }) => get(innerSelector) + 1,
		})
		const handleUpdate = vitest.fn()

		silo.subscribe(outerSelector, handleUpdate, `stable/subscriber`)

		const graphSet = vitest.spyOn(silo.store.selectorGraph, `set`)
		const graphDelete = vitest.spyOn(silo.store.selectorGraph, `delete`)
		const rootsSet = vitest.spyOn(silo.store.selectorAtoms, `set`)
		const rootsDelete = vitest.spyOn(silo.store.selectorAtoms, `delete`)

		silo.setState(rootAtom, 1)

		expect(handleUpdate).toHaveBeenCalledOnce()
		expect(handleUpdate).toHaveBeenCalledWith({ oldValue: 2, newValue: 3 })
		expect(graphSet).not.toHaveBeenCalled()
		expect(graphDelete).not.toHaveBeenCalled()
		expect(rootsSet).not.toHaveBeenCalled()
		expect(rootsDelete).not.toHaveBeenCalled()
	})

	it(`reconciles conditional roots before propagating later updates`, () => {
		const silo = makeSilo(`conditional`)
		const chooseRightAtom = silo.atom<boolean>({
			key: `chooseRight`,
			default: false,
		})
		const leftAtom = silo.atom<number>({
			key: `left`,
			default: 10,
		})
		const rightAtom = silo.atom<number>({
			key: `right`,
			default: 20,
		})
		const selectedSelector = silo.selector<number>({
			key: `selected`,
			get: ({ get }) => (get(chooseRightAtom) ? get(rightAtom) : get(leftAtom)),
		})
		const handleUpdate = vitest.fn()

		silo.subscribe(selectedSelector, handleUpdate, `conditional/subscriber`)
		expect(
			silo.store.selectorAtoms.getRelatedKeys(selectedSelector.key),
		).toEqual(new Set([chooseRightAtom.key, leftAtom.key]))

		silo.setState(chooseRightAtom, true)
		expect(
			silo.store.selectorAtoms.getRelatedKeys(selectedSelector.key),
		).toEqual(new Set([chooseRightAtom.key, rightAtom.key]))

		silo.setState(leftAtom, 11)
		expect(handleUpdate).toHaveBeenCalledOnce()

		silo.setState(rightAtom, 21)
		expect(handleUpdate).toHaveBeenCalledTimes(2)
		expect(handleUpdate).toHaveBeenLastCalledWith({
			oldValue: 20,
			newValue: 21,
		})
	})

	test.each([`first`, `second`] as const)(
		`shares root propagation when the %s subscriber unsubscribes first`,
		(firstToRemove) => {
			const silo = makeSilo(`subscribers/${firstToRemove}`)
			const rootAtom = silo.atom<number>({
				key: `root`,
				default: 0,
			})
			const doubledSelector = silo.selector<number>({
				key: `doubled`,
				get: ({ get }) => get(rootAtom) * 2,
			})
			const handlers = {
				first: vitest.fn(),
				second: vitest.fn(),
			}
			const unsubscribers = {
				first: silo.subscribe(
					doubledSelector,
					handlers.first,
					`subscriber/first`,
				),
				second: silo.subscribe(
					doubledSelector,
					handlers.second,
					`subscriber/second`,
				),
			}
			const rootState = silo.store.atoms.get(rootAtom.key)
			if (!rootState) throw new Error(`Expected root atom to exist`)

			expect(rootState.subject.subscribers).toHaveLength(1)
			silo.setState(rootAtom, 1)
			expect(handlers.first).toHaveBeenCalledOnce()
			expect(handlers.second).toHaveBeenCalledOnce()

			unsubscribers[firstToRemove]()
			expect(rootState.subject.subscribers).toHaveLength(1)

			const remaining = firstToRemove === `first` ? `second` : `first`
			silo.setState(rootAtom, 2)
			expect(handlers[firstToRemove]).toHaveBeenCalledOnce()
			expect(handlers[remaining]).toHaveBeenCalledTimes(2)

			unsubscribers[remaining]()
			expect(rootState.subject.subscribers).toHaveLength(0)
			silo.setState(rootAtom, 3)
			expect(handlers[firstToRemove]).toHaveBeenCalledOnce()
			expect(handlers[remaining]).toHaveBeenCalledTimes(2)
		},
	)

	it(`does not leak conditional dependencies from an aborted transaction`, () => {
		const silo = makeSilo(`transaction`)
		const chooseRightAtom = silo.atom<boolean>({
			key: `chooseRight`,
			default: false,
		})
		const leftAtom = silo.atom<number>({
			key: `left`,
			default: 10,
		})
		const rightAtom = silo.atom<number>({
			key: `right`,
			default: 20,
		})
		const selectedSelector = silo.selector<number>({
			key: `selected`,
			get: ({ get }) => (get(chooseRightAtom) ? get(rightAtom) : get(leftAtom)),
		})
		const handleUpdate = vitest.fn()
		const abortTransaction = silo.transaction<() => void>({
			key: `transaction/abort`,
			do: ({ get, set }) => {
				set(chooseRightAtom, true)
				expect(get(selectedSelector)).toBe(20)
				throw new Error(`abort`)
			},
		})

		expect(
			silo.store.selectorAtoms.getRelatedKeys(selectedSelector.key),
		).toBeUndefined()
		expect(() => {
			silo.runTransaction(abortTransaction)()
		}).toThrow(`abort`)

		expect(silo.store.child).toBeNull()
		expect(
			silo.store.selectorAtoms.getRelatedKeys(selectedSelector.key),
		).toBeUndefined()
		expect(silo.getState(selectedSelector)).toBe(10)
		expect(
			silo.store.selectorAtoms.getRelatedKeys(selectedSelector.key),
		).toEqual(new Set([chooseRightAtom.key, leftAtom.key]))
		silo.subscribe(selectedSelector, handleUpdate, `transaction/subscriber`)

		silo.setState(rightAtom, 21)
		expect(handleUpdate).not.toHaveBeenCalled()
		silo.setState(leftAtom, 11)
		expect(handleUpdate).toHaveBeenCalledOnce()
		expect(handleUpdate).toHaveBeenLastCalledWith({
			oldValue: 10,
			newValue: 11,
		})
	})

	it(`reconciles dependencies discovered after an async boundary`, async () => {
		const silo = makeSilo(`async`)
		const chooseRightAtom = silo.atom<boolean>({
			key: `chooseRight`,
			default: false,
		})
		const leftAtom = silo.atom<number>({
			key: `left`,
			default: 10,
		})
		const rightAtom = silo.atom<number>({
			key: `right`,
			default: 20,
		})
		const selectedSelector = silo.selector<Promise<number> | number>({
			key: `selected`,
			get: async ({ get }) => {
				const chooseRight = get(chooseRightAtom)
				await Promise.resolve()
				return get(chooseRight ? rightAtom : leftAtom)
			},
		})
		const handleUpdate = vitest.fn()

		silo.subscribe(selectedSelector, handleUpdate, `async/subscriber`)
		expect(await silo.getState(selectedSelector)).toBe(10)
		expect(silo.store.atoms.get(leftAtom.key)?.subject.subscribers).toHaveLength(
			1,
		)

		silo.setState(chooseRightAtom, true)
		expect(await silo.getState(selectedSelector)).toBe(20)
		expect(silo.store.atoms.get(leftAtom.key)?.subject.subscribers).toHaveLength(
			0,
		)
		expect(
			silo.store.atoms.get(rightAtom.key)?.subject.subscribers,
		).toHaveLength(1)

		handleUpdate.mockClear()
		silo.setState(rightAtom, 21)
		expect(await silo.getState(selectedSelector)).toBe(21)
		expect(handleUpdate).toHaveBeenCalled()
	})

	it(`terminates root tracing when the selector graph contains a cycle`, () => {
		const silo = makeSilo(`cycle`)
		const rootAtom = silo.atom<number>({
			key: `root`,
			default: 1,
		})
		const firstSelector = silo.selector<number>({
			key: `first`,
			get: ({ get }) => get(rootAtom) + 1,
		})
		const secondSelector = silo.selector<number>({
			key: `second`,
			get: ({ get }) => get(firstSelector) + 1,
		})
		const thirdSelector = silo.selector<number>({
			key: `third`,
			get: ({ get }) => get(secondSelector) + 1,
		})

		expect(silo.getState(thirdSelector)).toBe(4)
		silo.store.selectorGraph.set(thirdSelector.key, firstSelector.key, {
			source: thirdSelector.key,
		})

		const roots = Internal.traceRootSelectorAtoms(silo.store, firstSelector.key)
		expect(roots).toEqual(
			new Map([[rootAtom.key, silo.store.atoms.get(rootAtom.key)]]),
		)
	})
})
