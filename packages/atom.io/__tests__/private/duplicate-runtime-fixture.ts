import assert from "node:assert/strict"
import { cp, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type * as Core from "atom.io"
import type * as Internal from "atom.io/internal"
import type * as ReactAdapter from "atom.io/react"
import type * as RealtimeReact from "atom.io/realtime-react"
import type * as SolidAdapter from "atom.io/solid"
import { Window } from "happy-dom"
import * as React from "react"
import type * as ReactDOMClient from "react-dom/client"
import * as Solid from "solid-js"

type FixtureModules = {
	main: typeof Core
	internal: typeof Internal
	react: typeof ReactAdapter
	solid: typeof SolidAdapter
} & Record<`realtime-react`, typeof RealtimeReact>

type CounterProps = { id: string; token: Core.RegularAtomToken<number> }
type CounterUpdate = number | ((value: number) => number)

async function act(callback: () => void): Promise<void> {
	await React.act(async () => {
		callback()
		await Promise.resolve()
	})
}

const packageRoot = fileURLToPath(new URL(`../../`, import.meta.url))
const fixtureRoot = await mkdtemp(join(tmpdir(), `atom-io-duplicate-runtime-`))
const window = new Window()
Object.assign(globalThis, {
	window,
	document: window.document,
	HTMLElement: window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
})
const { createRoot } = await import(`react-dom/client`)

try {
	await symlink(
		join(packageRoot, `node_modules`),
		join(fixtureRoot, `node_modules`),
		`dir`,
	)
	for (const name of [`a`, `b`, `isolated/c`, `isolated/d`]) {
		const destination = join(fixtureRoot, name)
		await cp(join(packageRoot, `dist`), join(destination, `dist`), {
			recursive: true,
		})
		await cp(
			join(packageRoot, `package.json`),
			join(destination, `package.json`),
		)
	}
	// A second pair of atom.io copies resolves separate physical React and Solid runtimes.
	const isolatedDependencies = join(fixtureRoot, `isolated/node_modules`)
	for (const peer of [`react`, `react-dom`, `solid-js`]) {
		const peerRoot = dirname(
			fileURLToPath(import.meta.resolve(`${peer}/package.json`)),
		)
		await cp(peerRoot, join(isolatedDependencies, peer), { recursive: true })
	}
	const load = <Entry extends keyof FixtureModules>(
		copy: `a` | `b` | `isolated/c` | `isolated/d`,
		entry: Entry,
	): Promise<FixtureModules[Entry]> =>
		import(
			pathToFileURL(join(fixtureRoot, copy, `dist`, entry, `index.js`)).href
		) as Promise<FixtureModules[Entry]>
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
	const reactA = await load(`a`, `react`)
	const reactB = await load(`b`, `react`)
	assert.equal(reactA.StoreContext, reactB.StoreContext)

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

	const solidA = await load(`a`, `solid`)
	const solidB = await load(`b`, `solid`)
	assert.equal(solidA.StoreContext, solidB.StoreContext)
	const testSolidStore = (
		runtime: typeof Solid,
		provider: typeof SolidAdapter,
		consumer: typeof SolidAdapter,
		initial: number,
	): void => {
		const { silo, token } = makeSilo(`solid-${initial}`, initial)
		let read: (() => number) | undefined
		let write: ((next: CounterUpdate) => void) | undefined
		let observed: number | undefined
		const dispose = runtime.createRoot((rootDispose) => {
			provider.StoreContext.Provider({
				value: silo.store,
				get children() {
					assert.equal(runtime.useContext(consumer.StoreContext), silo.store)
					const value = consumer.useO(token)
					read = value
					write = consumer.useI(token)
					runtime.createEffect(() => {
						observed = value()
					})
					return null
				},
			})
			return rootDispose
		})
		try {
			assert.ok(read)
			assert.ok(write)
			assert.equal(read(), initial)
			assert.equal(observed, initial)
			write((value) => value + 1)
			assert.equal(read(), initial + 1)
			assert.equal(observed, initial + 1)
			assert.equal(silo.getState(token), initial + 1)
			assert.equal(outer.silo.getState(outer.token), 2)
		} finally {
			dispose()
		}
	}
	testSolidStore(Solid, solidA, solidB, 2000)
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
	const realtimeRoot = createRoot(hostA)
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
		assert.equal(hostA.textContent, `shared realtime context`)
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
	assert.notEqual(isolatedReact.createContext, React.createContext)
	const reactC = await load(`isolated/c`, `react`)
	const reactD = await load(`isolated/d`, `react`)
	const realtimeC = await load(`isolated/c`, `realtime-react`)
	const realtimeD = await load(`isolated/d`, `realtime-react`)
	assert.equal(reactC.StoreContext, reactD.StoreContext)
	assert.notEqual(reactC.StoreContext, reactA.StoreContext)
	assert.equal(realtimeC.RealtimeContext, realtimeD.RealtimeContext)
	assert.notEqual(realtimeC.RealtimeContext, realtimeA.RealtimeContext)

	const isolated = makeSilo(`isolated`, 1000)
	const isolatedRealtimeValue: RealtimeReact.RealtimeReactStore = {
		socket: null,
		services: new Map(),
	}
	let setIsolated: ((next: CounterUpdate) => void) | undefined
	function IsolatedCounter(): React.ReactElement {
		const value = reactD.useO(isolated.token)
		setIsolated = reactD.useI(isolated.token)
		assert.equal(
			isolatedReact.useContext(realtimeD.RealtimeContext),
			isolatedRealtimeValue,
		)
		return isolatedReact.createElement(`span`, null, value)
	}
	const isolatedHost = document.createElement(`div`)
	const isolatedRoot = isolatedDOM.createRoot(isolatedHost)
	try {
		await isolatedReact.act(async () => {
			isolatedRoot.render(
				isolatedReact.createElement(reactC.StoreProvider, {
					store: isolated.silo.store,
					children: isolatedReact.createElement(
						realtimeC.RealtimeContext.Provider,
						{ value: isolatedRealtimeValue },
						isolatedReact.createElement(IsolatedCounter),
					),
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
	const isolatedSolid = (await import(
		pathToFileURL(join(isolatedDependencies, `solid-js/dist/solid.js`)).href
	)) as typeof Solid
	assert.notEqual(isolatedSolid.createContext, Solid.createContext)
	const solidC = await load(`isolated/c`, `solid`)
	const solidD = await load(`isolated/d`, `solid`)
	assert.equal(solidC.StoreContext, solidD.StoreContext)
	assert.notEqual(solidC.StoreContext, solidA.StoreContext)
	testSolidStore(isolatedSolid, solidC, solidD, 3000)
} finally {
	await window.happyDOM.close()
	await rm(fixtureRoot, { recursive: true, force: true })
}
