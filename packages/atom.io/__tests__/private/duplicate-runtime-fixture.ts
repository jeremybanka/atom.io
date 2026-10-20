import assert from "node:assert/strict"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import type * as Core from "atom.io"
import type * as Internal from "atom.io/internal"
import type * as RealtimeReact from "atom.io/realtime-react"
import * as React from "react"
import type * as ReactDOMClient from "react-dom/client"

import { withRuntimeCopies } from "../../../../scripts/runtime-copies.ts"

type FixtureModules = {
	main: typeof Core
	internal: typeof Internal
} & Record<`realtime-react`, typeof RealtimeReact>
async function act(callback: () => void): Promise<void> {
	await React.act(async () => {
		callback()
		await Promise.resolve()
	})
}
await withRuntimeCopies<FixtureModules>(
	new URL(`../../`, import.meta.url),
	[`react`],
	[`react`, `react-dom`],
	async ({ load, isolatedDependencies }) => {
		const { createRoot } = await import(`react-dom/client`)
		const host = document.createElement(`div`)
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
		const realtimeA = await load(`a`, `realtime-react`)
		const realtimeB = await load(`b`, `realtime-react`)
		assert.equal(realtimeA.RealtimeContext, realtimeB.RealtimeContext)
		const realtimeValue: RealtimeReact.RealtimeReactStore = {
			socket: null,
			services: new Map(),
		}
		function RealtimeConsumer(): React.ReactElement {
			assert.equal(React.useContext(realtimeB.RealtimeContext), realtimeValue)
			return React.createElement(`span`, null, `shared realtime context`)
		}
		const realtimeRoot = createRoot(host)
		try {
			await act(() => {
				realtimeRoot.render(
					React.createElement(
						realtimeA.RealtimeContext.Provider,
						{ value: realtimeValue },
						React.createElement(RealtimeConsumer),
					),
				)
			})
			assert.equal(host.textContent, `shared realtime context`)
		} finally {
			await act(() => {
				realtimeRoot.unmount()
			})
		}

		const isolatedReact = (await import(
			pathToFileURL(join(isolatedDependencies, `react/index.js`)).href
		)) as typeof React
		const isolatedDOM = (await import(
			pathToFileURL(join(isolatedDependencies, `react-dom/client.js`)).href
		)) as typeof ReactDOMClient
		const realtimeC = await load(`isolated/c`, `realtime-react`)
		const realtimeD = await load(`isolated/d`, `realtime-react`)
		assert.equal(realtimeC.RealtimeContext, realtimeD.RealtimeContext)
		assert.notEqual(realtimeC.RealtimeContext, realtimeA.RealtimeContext)
		const isolatedValue: RealtimeReact.RealtimeReactStore = {
			socket: null,
			services: new Map(),
		}
		function IsolatedConsumer(): React.ReactElement {
			assert.equal(
				isolatedReact.useContext(realtimeD.RealtimeContext),
				isolatedValue,
			)
			return isolatedReact.createElement(
				`span`,
				null,
				`isolated realtime context`,
			)
		}
		const isolatedRoot = isolatedDOM.createRoot(host)
		try {
			await isolatedReact.act(async () => {
				isolatedRoot.render(
					isolatedReact.createElement(
						realtimeC.RealtimeContext.Provider,
						{ value: isolatedValue },
						isolatedReact.createElement(IsolatedConsumer),
					),
				)
				await Promise.resolve()
			})
			assert.equal(host.textContent, `isolated realtime context`)
		} finally {
			await isolatedReact.act(async () => {
				isolatedRoot.unmount()
				await Promise.resolve()
			})
		}
	},
)
