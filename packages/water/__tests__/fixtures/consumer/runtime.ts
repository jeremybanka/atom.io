import assert from "node:assert/strict"
import { test } from "node:test"

import { hydrate, onCleanup, render, useId, useValue } from "@atom.io/water"
import astro from "@atom.io/water/astro"
import astroClient from "@atom.io/water/astro-client"
import astroServer from "@atom.io/water/astro-server"
import { jsx, jsxDEV } from "@atom.io/water/jsx-dev-runtime"
import { renderToString } from "@atom.io/water/server"
import water from "@atom.io/water/vite"
import { Silo } from "atom.io"
import { Window } from "happy-dom"

await test(`packed runtime shares ownership across public entries, hydrates, updates, and disposes`, () => {
	const window = new Window()
	const host = window.document.createElement(`div`) as unknown as HTMLDivElement
	const silo = new Silo({
		name: `consumer`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 1 })
	let setups = 0,
		cleanups = 0
	const App = () => {
		setups++
		onCleanup(() => {
			cleanups++
		})
		const read = useValue(countAtom),
			id = useId()
		return jsx(`output`, { id, children: read })
	}
	host.innerHTML = renderToString(() => jsx(App, {}), {
		store: silo.store,
		idPrefix: `consumer`,
	})
	const output = host.querySelector(`output`)!
	const root = hydrate(() => jsxDEV(App, {}), host, { store: silo.store })
	assert.equal(host.querySelector(`output`), output)
	assert.equal(output.id, `consumer-0`)
	silo.setState(countAtom, 2)
	root.flush()
	assert.equal(output.textContent, `2`)
	assert.equal(setups, 2)
	root.dispose()
	assert.equal(cleanups, 2)
	assert.equal(host.childNodes.length, 0)
	const mounted = render(() => jsx(App, {}), host, { store: silo.store })
	mounted.dispose()
})
await test(`packed compiler and Astro adapters expose working entrypoints`, async () => {
	const plugin = water()
	const result = (plugin.transform as Function)(
		`export default () => <p>{read()}</p>`,
		`App.water.tsx`,
	)
	assert.match(result.code, /\(\) => read\(\)/)
	assert.match(result.code, /water = true/)
	assert.equal(astro().name, `@atom.io/water`)
	assert.equal(typeof astroClient, `function`)
	assert.equal(
		await (astroServer.check as Function)(
			Object.assign(() => null, { water: true }),
		),
		true,
	)
})
