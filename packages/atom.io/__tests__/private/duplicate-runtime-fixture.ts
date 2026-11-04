import assert from "node:assert/strict"

import type * as Core from "atom.io"
import type * as Internal from "atom.io/internal"

import { withRuntimeCopies } from "../../../../scripts/runtime-copies.ts"

type FixtureModules = {
	main: typeof Core
	internal: typeof Internal
}
await withRuntimeCopies<FixtureModules>(
	new URL(`../../`, import.meta.url),
	[`react`],
	[`react`, `react-dom`],
	async ({ load }) => {
		const coreA = await load(`a`, `main`)
		const coreB = await load(`b`, `main`)
		assert.notEqual(
			coreA.Silo,
			coreB.Silo,
			`the fixture must load physically distinct modules`,
		)
		const internalA = await load(`a`, `internal`)
		const internalB = await load(`b`, `internal`)
		assert.equal(
			globalThis.ATOM_IO_IMPLICIT_STORE,
			undefined,
			`core imports must remain lazy`,
		)
		// An already installed implicit store must still be adopted by both copies.
		const existingStore = new internalA.Store({
			name: `IMPLICIT_STORE`,
			lifespan: `ephemeral`,
			isProduction: true,
		}) as Internal.RootStore
		globalThis.ATOM_IO_IMPLICIT_STORE = existingStore
		assert.equal(internalA.IMPLICIT.STORE, existingStore)
		assert.equal(internalB.IMPLICIT.STORE, existingStore)

		const firstCountAtom = coreA.atom<number>({ key: `firstCount`, default: 1 })
		const secondCountAtom = coreA.atom<number>({
			key: `secondCount`,
			default: 10,
		})
		const useSecondAtom = coreA.atom<boolean>({
			key: `useSecond`,
			default: false,
		})
		const selectedSelector = coreA.selector<number>({
			key: `selected`,
			get: ({ get }) =>
				get(useSecondAtom) ? get(secondCountAtom) : get(firstCountAtom),
		})
		const values: number[] = []
		const stop = coreB.subscribe(selectedSelector, ({ newValue }) => {
			values.push(newValue)
		})
		const switchTransaction = coreB.transaction<() => void>({
			key: `switch`,
			do: ({ set }) => {
				set(useSecondAtom, true)
			},
		})
		coreB.runTransaction(switchTransaction)()
		coreB.setState(secondCountAtom, 11)
		coreA.setState(firstCountAtom, 2)
		assert.deepEqual(values, [10, 11])
		stop()
	},
)
