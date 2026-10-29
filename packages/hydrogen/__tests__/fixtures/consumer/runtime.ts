import assert from "node:assert/strict"
import { test } from "node:test"

import type { Loadable } from "atom.io"
import { scopeFamily, Silo } from "atom.io"
import { Window } from "happy-dom"
import {
	hydrate,
	onCleanup,
	render,
	useId,
	useLoadable,
	useRef,
	useSetter,
	useTimeline,
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

await test(`packed family hooks bind keyed state, refs, and history`, () => {
	const host = new Window().document.createElement(
		`section`,
	) as unknown as HTMLElement
	const silo = new Silo({
		name: `family-consumer`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtoms = silo.atomFamily<number, number>({
		key: `count`,
		default: 0,
	})
	const elementAtoms = silo.atomFamily<HTMLButtonElement | null, number>({
		key: `element`,
		default: null,
	})
	const historyTimelines = silo.timelineFamily<number>({
		key: `history`,
		scope: [scopeFamily(countAtoms, { timelineKey: (key) => key })],
	})
	const root = render(
		() => {
			const count = useValue(countAtoms, 0)
			const setCount = useSetter(countAtoms, 0)
			const ref = useRef(elementAtoms, 0)
			const history = useTimeline(historyTimelines, 0)
			return jsx(`button`, {
				ref,
				onClick: () => {
					setCount((value) => value + 1)
				},
				children: () => `${count()}:${history().at}`,
			})
		},
		host,
		{ store: silo.store },
	)
	try {
		silo.clearTimeline(historyTimelines, 0)
		root.flush()
		const button = host.querySelector(`button`)!
		assert.equal(silo.getState(elementAtoms, 0), button)
		button.click()
		root.flush()
		assert.equal(host.textContent, `1:1`)
		silo.undo(historyTimelines, 0)
		root.flush()
		assert.equal(host.textContent, `0:0`)
	} finally {
		root.dispose()
	}
	assert.equal(silo.getState(elementAtoms, 0), null)
	const history = silo.findTimeline(historyTimelines, 0)
	assert.equal(
		silo.store.timelines.get(history.key)!.subject.subscribers.size,
		0,
	)
})
