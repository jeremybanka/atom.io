import assert from "node:assert/strict"
import {
	cp,
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { Window } from "happy-dom"
import * as React from "react"
import {
	createRoot as createSolidRoot,
	useContext as useSolidContext,
} from "solid-js"

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
const legacyStore = { legacy: true }
globalThis.ATOM_IO_IMPLICIT_STORE = legacyStore

try {
	await symlink(
		join(packageRoot, `node_modules`),
		join(fixtureRoot, `node_modules`),
		`dir`,
	)
	for (const name of [`a`, `b`, `incompatible`]) {
		const destination = join(fixtureRoot, name)
		await cp(join(packageRoot, `dist`), join(destination, `dist`), {
			recursive: true,
		})
		await cp(
			join(packageRoot, `package.json`),
			join(destination, `package.json`),
		)
	}
	// Simulate a future build that deliberately declares a different runtime ABI.
	const incompatibleDist = join(fixtureRoot, `incompatible/dist`)
	let replacements = 0
	for (const entry of await readdir(incompatibleDist, { recursive: true })) {
		if (!entry.endsWith(`.js`)) continue
		const path = join(incompatibleDist, entry)
		const source = await readFile(path, `utf8`)
		if (source.includes(`atom.io/runtime/1`)) {
			await writeFile(
				path,
				source.replaceAll(
					`atom.io/runtime/1`,
					`atom.io/runtime/test-incompatible`,
				),
			)
			replacements++
		}
	}
	assert.ok(replacements > 0)
	const load = (copy, entry) =>
		import(
			pathToFileURL(join(fixtureRoot, copy, `dist`, entry, `index.js`)).href
		)
	const coreA = await load(`a`, `main`)
	const coreB = await load(`b`, `main`)
	assert.notEqual(
		coreA.Silo,
		coreB.Silo,
		`the fixture must load physically distinct modules`,
	)
	const internalA = await load(`a`, `internal`)
	const internalB = await load(`b`, `internal`)
	assert.equal(internalA.RUNTIME, internalB.RUNTIME)
	assert.equal(
		internalA.RUNTIME.implicitStore,
		undefined,
		`core imports must remain lazy`,
	)
	assert.equal(internalA.IMPLICIT.STORE, internalB.IMPLICIT.STORE)
	assert.notEqual(internalA.IMPLICIT.STORE, legacyStore)
	assert.equal(globalThis.ATOM_IO_IMPLICIT_STORE, legacyStore)
	const reactA = await load(`a`, `react`)
	const reactB = await load(`b`, `react`)
	assert.equal(reactA.StoreContext, reactB.StoreContext)

	const makeSilo = (name, initial) => {
		const silo = new coreA.Silo({
			name,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const token = silo.atom({ key: `duplicate-copy-counter`, default: initial })
		return { silo, token }
	}
	const outer = makeSilo(`outer`, 1)
	const nested = makeSilo(`nested`, 10)
	const separate = makeSilo(`separate`, 100)
	const setters = new Map()
	function Counter({ id, token }) {
		const value = reactB.useO(token)
		setters.set(id, reactB.useI(token))
		return React.createElement(`span`, { id }, value)
	}
	const counter = (id, token) => React.createElement(Counter, { id, token })
	const hostA = document.createElement(`div`)
	const hostB = document.createElement(`div`)
	const rootA = createRoot(hostA)
	const rootB = createRoot(hostB)
	try {
		await React.act(async () => {
			await Promise.resolve()
			rootA.render(
				React.createElement(
					reactA.StoreProvider,
					{ store: outer.silo.store },
					counter(`outer`, outer.token),
					React.createElement(
						reactA.StoreProvider,
						{ store: nested.silo.store },
						counter(`nested`, nested.token),
					),
				),
			)
			rootB.render(
				React.createElement(
					reactA.StoreProvider,
					{ store: separate.silo.store },
					counter(`separate`, separate.token),
				),
			)
		})
		assert.equal(hostA.querySelector(`#outer`).textContent, `1`)
		assert.equal(hostA.querySelector(`#nested`).textContent, `10`)
		assert.equal(hostB.textContent, `100`)
		await React.act(() => setters.get(`nested`)((value) => value + 1))
		assert.equal(nested.silo.getState(nested.token), 11)
		assert.equal(hostA.querySelector(`#nested`).textContent, `11`)
		assert.equal(hostA.querySelector(`#outer`).textContent, `1`)
		assert.equal(hostB.textContent, `100`)
		await React.act(async () => {
			await Promise.resolve()
			setters.get(`outer`)(2)
			setters.get(`separate`)(101)
		})
		assert.equal(outer.silo.getState(outer.token), 2)
		assert.equal(separate.silo.getState(separate.token), 101)
		assert.equal(hostA.querySelector(`#outer`).textContent, `2`)
		assert.equal(hostB.textContent, `101`)
	} finally {
		await React.act(async () => {
			await Promise.resolve()
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
	const realtimeValue = { socket: null, services: new Map() }
	function RealtimeConsumer() {
		assert.equal(React.useContext(realtimeB.RealtimeContext), realtimeValue)
		return React.createElement(`span`, null, `shared realtime context`)
	}
	const realtimeRoot = createRoot(hostA)
	try {
		await React.act(() =>
			realtimeRoot.render(
				React.createElement(
					realtimeA.RealtimeContext.Provider,
					{ value: realtimeValue },
					React.createElement(RealtimeConsumer),
				),
			),
		)
		assert.equal(hostA.textContent, `shared realtime context`)
	} finally {
		await React.act(() => realtimeRoot.unmount())
	}
	const incompatible = await load(`incompatible`, `internal`)
	assert.notEqual(incompatible.RUNTIME, internalA.RUNTIME)
	assert.notEqual(incompatible.IMPLICIT.STORE, internalA.IMPLICIT.STORE)
	for (const [entry, context, compatible] of [
		[`react`, `StoreContext`, reactA],
		[`solid`, `StoreContext`, solidA],
		[`realtime-react`, `RealtimeContext`, realtimeA],
	]) {
		assert.notEqual(
			(await load(`incompatible`, entry))[context],
			compatible[context],
		)
	}
} finally {
	await window.happyDOM.close()
	await rm(fixtureRoot, { recursive: true, force: true })
}
