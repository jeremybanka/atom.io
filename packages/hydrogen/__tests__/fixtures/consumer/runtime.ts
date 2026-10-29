import assert from "node:assert/strict"
import { test } from "node:test"

import type { Loadable } from "atom.io"
import { Silo } from "atom.io"
import { Window } from "happy-dom"
import {
	hydrate,
	onCleanup,
	render,
	useId,
	useLoadable,
	useValue,
} from "hydrogen"
import astro from "hydrogen/astro"
import astroClient from "hydrogen/astro-client"
import astroServer from "hydrogen/astro-server"
import { jsx, jsxDEV } from "hydrogen/jsx-dev-runtime"
import { renderToString } from "hydrogen/server"
import hydrogen from "hydrogen/vite"

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
	const plugin = hydrogen()
	const result = (plugin.transform as Function)(
		`export default () => <p>{read()}</p>`,
		`App.hydrogen.tsx`,
	)
	assert.match(result.code, /\(\) => read\(\)/)
	assert.match(result.code, /hydrogen = true/)
	assert.equal(astro().name, `hydrogen`)
	assert.equal(typeof astroClient, `function`)
	assert.equal(
		await (astroServer.check as Function)(
			Object.assign(() => null, { hydrogen: true }),
		),
		true,
	)
})

await test(`packed loadable accessor resolves async state in its root store`, async () => {
	const host = new Window().document.createElement(
		`section`,
	) as unknown as HTMLElement
	const silo = new Silo({
		name: `loadable-consumer`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const deferred = Promise.withResolvers<string>()
	const loadableAtom = silo.atom<Loadable<string>>({
		key: `loadable`,
		default: () => deferred.promise,
	})
	const root = render(
		() => {
			const value = useLoadable(loadableAtom, `pending`)
			return jsx(`output`, { children: () => value().value })
		},
		host,
		{ store: silo.store },
	)
	try {
		assert.equal(host.textContent, `pending`)
		deferred.resolve(`ready`)
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
		root.flush()
		assert.equal(host.textContent, `ready`)
	} finally {
		root.dispose()
	}
	assert.equal(
		silo.store.atoms.get(loadableAtom.key)!.subject.subscribers.size,
		0,
	)
})
