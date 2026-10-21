import assert from "node:assert/strict"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import type * as ReactAdapter from "@atom.io/react"
import type * as Core from "atom.io"
import * as React from "react"
import type * as ReactDOMClient from "react-dom/client"

import { withRuntimeCopies } from "../../../../scripts/runtime-copies.ts"

type FixtureModules = { main: typeof Core; react: typeof ReactAdapter }
type CounterProps = { id: string; token: Core.RegularAtomToken<number> }
type CounterUpdate = number | ((value: number) => number)
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
		const coreA = await load(`a`, `main`)
		const { createRoot } = await import(`react-dom/client`)
		const makeSilo = (name: string, initial: number) => {
			const silo = new coreA.Silo({
				name,
				lifespan: `ephemeral`,
				isProduction: true,
			})
			const counterAtom = silo.atom<number>({
				key: `counter`,
				default: initial,
			})
			return { silo, token: counterAtom }
		}
		const reactA = await load(`a`, `react`)
		const reactB = await load(`b`, `react`)
		assert.equal(reactA.StoreContext, reactB.StoreContext)

		const outer = makeSilo(`outer`, 1)
		const nested = makeSilo(`nested`, 10)
		const separate = makeSilo(`separate`, 100)
		const setters = new Map<string, (next: CounterUpdate) => void>()
		const setCounter = (id: string, next: CounterUpdate): void => {
			const setter = setters.get(id)
			assert.ok(setter, `counter "${id}" must be mounted`)
			setter(next)
		}
		function Counter({ id, token }: CounterProps): React.ReactElement {
			const value = reactB.useO(token)
			setters.set(id, reactB.useI(token))
			return React.createElement(`span`, { id }, value)
		}
		const counter = (id: string, token: Core.RegularAtomToken<number>) =>
			React.createElement(Counter, { id, token })
		const hostA = document.createElement(`div`)
		const hostB = document.createElement(`div`)
		const rootA = createRoot(hostA)
		const rootB = createRoot(hostB)
		try {
			await act(() => {
				rootA.render(
					React.createElement(reactA.StoreProvider, {
						store: outer.silo.store,
						children: React.createElement(
							React.Fragment,
							null,
							counter(`outer`, outer.token),
							React.createElement(reactA.StoreProvider, {
								store: nested.silo.store,
								children: counter(`nested`, nested.token),
							}),
						),
					}),
				)
				rootB.render(
					React.createElement(reactA.StoreProvider, {
						store: separate.silo.store,
						children: counter(`separate`, separate.token),
					}),
				)
			})
			assert.equal(hostA.querySelector(`#outer`)?.textContent, `1`)
			assert.equal(hostA.querySelector(`#nested`)?.textContent, `10`)
			assert.equal(hostB.textContent, `100`)
			await act(() => {
				setCounter(`nested`, (value) => value + 1)
			})
			assert.equal(nested.silo.getState(nested.token), 11)
			assert.equal(hostA.querySelector(`#nested`)?.textContent, `11`)
			assert.equal(hostA.querySelector(`#outer`)?.textContent, `1`)
			assert.equal(hostB.textContent, `100`)
			await act(() => {
				setCounter(`outer`, 2)
				setCounter(`separate`, 101)
			})
			assert.equal(outer.silo.getState(outer.token), 2)
			assert.equal(separate.silo.getState(separate.token), 101)
			assert.equal(hostA.querySelector(`#outer`)?.textContent, `2`)
			assert.equal(hostB.textContent, `101`)
		} finally {
			await act(() => {
				rootA.unmount()
				rootB.unmount()
			})
		}

		const isolatedReact = (await import(
			pathToFileURL(join(isolatedDependencies, `react/index.js`)).href
		)) as typeof React
		const isolatedDOM = (await import(
			pathToFileURL(join(isolatedDependencies, `react-dom/client.js`)).href
		)) as typeof ReactDOMClient
		assert.notEqual(isolatedReact.createContext, React.createContext)
		const reactC = await load(`isolated/c`, `react`)
		const reactD = await load(`isolated/d`, `react`)
		assert.equal(reactC.StoreContext, reactD.StoreContext)
		assert.notEqual(reactC.StoreContext, reactA.StoreContext)

		const isolated = makeSilo(`isolated`, 1000)
		let setIsolated: ((next: CounterUpdate) => void) | undefined
		function IsolatedCounter(): React.ReactElement {
			const value = reactD.useO(isolated.token)
			setIsolated = reactD.useI(isolated.token)
			return isolatedReact.createElement(`span`, null, value)
		}
		const isolatedHost = document.createElement(`div`)
		const isolatedRoot = isolatedDOM.createRoot(isolatedHost)
		try {
			await isolatedReact.act(async () => {
				isolatedRoot.render(
					isolatedReact.createElement(reactC.StoreProvider, {
						store: isolated.silo.store,
						children: isolatedReact.createElement(IsolatedCounter),
					}),
				)
				await Promise.resolve()
			})
			assert.equal(isolatedHost.textContent, `1000`)
			await isolatedReact.act(async () => {
				assert.ok(setIsolated)
				setIsolated((value) => value + 1)
				await Promise.resolve()
			})
			assert.equal(isolatedHost.textContent, `1001`)
			assert.equal(isolated.silo.getState(isolated.token), 1001)
			assert.equal(outer.silo.getState(outer.token), 2)
		} finally {
			await isolatedReact.act(async () => {
				isolatedRoot.unmount()
				await Promise.resolve()
			})
		}
	},
)
