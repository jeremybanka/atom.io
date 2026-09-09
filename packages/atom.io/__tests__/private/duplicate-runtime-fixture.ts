import assert from "node:assert/strict"
import { cp, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type * as Core from "atom.io"
import type * as Internal from "atom.io/internal"
import type * as ReactAdapter from "atom.io/react"
import type * as RealtimeReact from "atom.io/realtime-react"
import type * as SolidAdapter from "atom.io/solid"
import { Window } from "happy-dom"
import * as React from "react"
import {
	createRoot as createSolidRoot,
	useContext as useSolidContext,
} from "solid-js"

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
	for (const name of [`a`, `b`]) {
		const destination = join(fixtureRoot, name)
		await cp(join(packageRoot, `dist`), join(destination, `dist`), {
			recursive: true,
		})
		await cp(
			join(packageRoot, `package.json`),
			join(destination, `package.json`),
		)
	}
	const load = <Entry extends keyof FixtureModules>(
		copy: `a` | `b`,
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
	createSolidRoot((dispose) => {
		try {
			solidA.StoreContext.Provider({
				value: outer.silo.store,
				get children() {
					assert.equal(useSolidContext(solidB.StoreContext), outer.silo.store)
					return null
				},
			})
		} finally {
			dispose()
		}
	})
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
} finally {
	await window.happyDOM.close()
	await rm(fixtureRoot, { recursive: true, force: true })
}
