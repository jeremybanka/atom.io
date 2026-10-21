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
	},
)
