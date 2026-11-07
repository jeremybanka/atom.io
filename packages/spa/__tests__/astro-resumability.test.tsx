import {
	atom,
	getState,
	type Loadable,
	resetState,
	setState,
	Silo,
} from "atom.io"
import { IMPLICIT, resetInStore, Store } from "atom.io/internal"
import { resumable as clientValue } from "resumability/client"
import { collect, resumable as serverValue } from "resumability/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import integration from "../src/astro.ts"
import { browserApplication } from "../src/astro-application.ts"
import { requestApplication } from "../src/astro-request.ts"
import client from "../src/astro-resumability-client.ts"
import server from "../src/astro-resumability-server.ts"
import type { Island } from "../src/astro-shared.ts"
import { onCleanup, useStore } from "../src/core.ts"
import { renderToString } from "../src/server.ts"
import { useLoadable } from "../src/use-loadable.ts"

const originalStore = IMPLICIT.STORE
beforeEach(() => {
	globalThis.ATOM_IO_IMPLICIT_STORE = new Store({
		name: `test`,
		lifespan: `ephemeral`,
		isProduction: true,
	}) as typeof IMPLICIT.STORE
})
afterEach(() => {
	browserApplication(document).dispose()
	globalThis.ATOM_IO_IMPLICIT_STORE = originalStore
})
const render = (App: Island, request: Request) =>
	server.renderToStaticMarkup.call({ result: { request } } as any, App, {}, {})

it(`selects automatic adapters only when resumability is installed, in either order`, () => {
	for (const names of [
		[`spa`],
		[`spa`, `resumability`],
		[`resumability`, `spa`],
	]) {
		const addRenderer = vi.fn()
		;(integration().hooks[`astro:config:setup`] as Function)({
			config: { integrations: names.map((name) => ({ name })) },
			addRenderer,
			addMiddleware: vi.fn(),
			injectScript: vi.fn(),
			updateConfig: vi.fn(),
		})
		const result = addRenderer.mock.calls[0][0]
		for (const side of [`client`, `server`])
			expect(result[`${side}Entrypoint`]).toBe(
				names.includes(`resumability`)
					? `@atom.io/spa/astro-resumability-${side}`
					: `@atom.io/spa/astro-${side}`,
			)
	}
})

it(`discovers async defaults through conditional views without preloading unrelated atoms`, async () => {
	const unused = vi.fn()
	atom<void>({ key: `unused`, default: unused })
	const firstAtom = atom<Loadable<string>>({
		key: `first`,
		default: () =>
			serverValue({
				key: `firstAtom`,
				server: () => Promise.resolve(`show details`),
			}),
	})
	const secondAtom = atom<Loadable<string>>({
		key: `second`,
		default: () =>
			serverValue({
				key: `secondAtom`,
				server: () => Promise.resolve(`fresh stock`),
			}),
	})
	const cleanup = vi.fn()
	const Details: Island = () => {
		const value = useLoadable(secondAtom, `loading`)
		return <p>{value().value}</p>
	}
	const App: Island = () => {
		onCleanup(cleanup)
		const value = useLoadable(firstAtom, ``)
		return <main>{value().value ? <Details /> : null}</main>
	}
	const request = new Request(`http://test`)
	try {
		const result = await render(App, request)
		const payload = JSON.parse(result.attrs![`data-spa-resumption`])
		expect(result.html).toContain(`fresh stock`)
		expect(result.html).not.toContain(`loading`)
		expect(payload.values).toHaveLength(2)
		expect(cleanup).toHaveBeenCalledTimes(3)
		expect(unused).not.toHaveBeenCalled()
	} finally {
		requestApplication(request).application.dispose()
	}
})

it(`renders caught async failures and cancels a pending render with its request`, async () => {
	const failedAtom = atom<string | Promise<string>, Error>({
		key: `failed`,
		default: () => Promise.reject(new Error(`offline`)),
		catch: [Error],
	})
	const App: Island = () => {
		const value = useLoadable(failedAtom, ``)
		return <p>{value().error?.message ?? value().value}</p>
	}
	const request = new Request(`http://test/error`)
	expect((await render(App, request)).html).toContain(`offline`)
	requestApplication(request).application.dispose()
	const pendingAtom = atom<Loadable<string>>({
		key: `pending`,
		default: () => new Promise<string>(() => {}),
	})
	const started = Promise.withResolvers<void>()
	const Waiting: Island = () => {
		const value = useLoadable(pendingAtom, ``)
		started.resolve()
		return <p>{value().value}</p>
	}
	const controller = new AbortController()
	const aborted = new Request(`http://test/abort`, { signal: controller.signal })
	const rendering = render(Waiting, aborted)
	await started.promise
	controller.abort()
	await expect(rendering).rejects.toThrow()
})

it(`preserves an uncaught async producer failure and releases the render`, async () => {
	const failure = new Error(`inventory database unavailable`)
	const failedAtom = atom<Loadable<string>>({
		key: `failed`,
		default: () => Promise.reject(failure),
	})
	const cleanup = vi.fn()
	const App: Island = () => {
		onCleanup(cleanup)
		const value = useLoadable(failedAtom, ``)
		return <p>{value().value}</p>
	}
	const request = new Request(`http://test/uncaught`)
	try {
		await expect(render(App, request)).rejects.toBe(failure)
		expect(cleanup).toHaveBeenCalledOnce()
	} finally {
		requestApplication(request).application.dispose()
	}
})

it(`initializes a client-only private island without a sidecar and releases its scope on unmount`, async () => {
	let signal!: AbortSignal
	const valueAtom = atom<Loadable<string>>({
		key: `value`,
		default: () =>
			clientValue({
				key: `client-only`,
				server: () => `server`,
				client: (context) => {
					signal = context.signal
					return `fresh browser value`
				},
			}),
	})
	let selected!: ReturnType<typeof useStore>
	const App: Island = () => {
		selected = useStore()
		const value = useLoadable(valueAtom, ``)
		return <p>{value().value}</p>
	}
	App.isolate = true
	const host = document.createElement(`div`)
	const original = IMPLICIT.STORE.runDefault
	await client(host)(App, {}, {}, { client: `only` })
	expect(host.textContent).toBe(`fresh browser value`)
	expect(selected).not.toBe(IMPLICIT.STORE)
	expect(signal.aborted).toBe(false)
	expect(IMPLICIT.STORE.runDefault).toBe(original)
	host.dispatchEvent(new Event(`astro:unmount`))
	expect(host.childNodes).toHaveLength(0)
	expect(signal.aborted).toBe(true)
	expect(selected.runDefault).toBe(original)
})

it(`resumes shared defaults, refreshes through the client, and preserves live state on navigation`, async () => {
	const fresh = vi.fn(() => `database`)
	const stockAtom = atom<Loadable<string>>({
		key: `stock`,
		default: () =>
			clientValue({ key: `stockAtom`, server: () => `unused`, client: fresh }),
	})
	const App: Island = () => {
		const value = useLoadable(stockAtom, ``)
		return <p>{value().value}</p>
	}
	const wrapper = document.createElement(`astro-resumption`)
	wrapper.innerHTML = `<script data-resumable type="application/json">${JSON.stringify({ version: 1, values: [[`stockAtom`, [1, `server`]]] })}</script><div></div>`
	const host = wrapper.querySelector(`div`)!
	const Seed = () => {
		const value = () => `server`
		return <p>{value()}</p>
	}
	host.innerHTML = renderToString(() => () => <Seed />)
	await client(host)(App, {}, {}, { client: `load` })
	expect(host.textContent).toBe(`server`)
	expect(fresh).not.toHaveBeenCalled()
	resetState(stockAtom)
	expect(getState(stockAtom)).toBe(`database`)
	expect(fresh).toHaveBeenCalledOnce()
	setState(stockAtom, `local count`)
	document.dispatchEvent(new Event(`astro:before-swap`))
	host.dispatchEvent(new Event(`astro:unmount`))
	await client(host)(App, {}, {}, { client: `load` })
	expect(host.textContent).toBe(`local count`)
	expect(fresh).toHaveBeenCalledOnce()
	browserApplication(document).dispose()
	expect(host.childNodes).toHaveLength(0)
})

const seedOf = (result: { attrs?: Record<string, string> }) =>
	JSON.parse(result.attrs![`data-spa-resumption`])
const hostFor = (result: { html: string; attrs?: Record<string, string> }) => {
	const host = document.createElement(`div`)
	host.innerHTML = result.html
	host.setAttribute(`data-spa-resumption`, result.attrs![`data-spa-resumption`])
	return host
}

it(`resumes shared cached defaults even when the later server island hydrates first`, async () => {
	let serverSide = true
	let signal!: AbortSignal
	const producer = vi.fn((context: { signal: AbortSignal }) => {
		signal = context.signal
		return `server stock`
	})
	const fresh = vi.fn(() => `browser stock`)
	const stockAtom = atom<Loadable<string>>({
		key: `stock`,
		default: () =>
			serverSide
				? serverValue({ key: `stock`, server: producer })
				: clientValue({ key: `stock`, server: () => `unused`, client: fresh }),
	})
	const App: Island = () => {
		const value = useLoadable(stockAtom, ``)
		return <p>{value().value}</p>
	}
	const request = new Request(`http://test/shared`)
	try {
		const first = await render(App, request)
		const second = await render(App, request)
		expect(seedOf(first)).toEqual(seedOf(second))
		expect(seedOf(second).values).toEqual([[`stock`, [1, `server stock`]]])
		expect(producer).toHaveBeenCalledOnce()
		expect(signal.aborted).toBe(false)
		serverSide = false
		const a = hostFor(first),
			b = hostFor(second)
		const nodes = [a.querySelector(`p`), b.querySelector(`p`)]
		// Preserve explicit prefetches and prefer the island's seed for its own values.
		const wrapper = document.createElement(`astro-resumption`)
		wrapper.innerHTML = `<script data-resumable>${JSON.stringify({
			version: 1,
			values: [
				[`stock`, [1, `older stock`]],
				[`prefetched`, [1, `extra data`]],
			],
		})}</script>`
		wrapper.append(b)
		await client(b)(App, {}, {}, { client: `load` })
		await client(a)(App, {}, {}, { client: `visible` })
		const prefetchedAtom = atom<Loadable<string>>({
			key: `prefetched`,
			default: () => clientValue({ key: `prefetched`, server: () => `unused` }),
		})
		expect(getState(prefetchedAtom)).toBe(`extra data`)
		expect([a.querySelector(`p`), b.querySelector(`p`)]).toEqual(nodes)
		expect([a.textContent, b.textContent]).toEqual([
			`server stock`,
			`server stock`,
		])
		expect(fresh).not.toHaveBeenCalled()
		resetState(stockAtom)
		expect(getState(stockAtom)).toBe(`browser stock`)
		expect(fresh).toHaveBeenCalledOnce()
	} finally {
		requestApplication(request).application.dispose()
	}
	expect(signal.aborted).toBe(true)
})

it(`streams an unrelated island while another producer is pending`, async () => {
	const pending = Promise.withResolvers<string>()
	const started = Promise.withResolvers<void>()
	const slowAtom = atom<Loadable<string>>({
		key: `slow`,
		default: () =>
			serverValue({
				key: `slow`,
				server: () => {
					started.resolve()
					return pending.promise
				},
			}),
	})
	const fastAtom = atom<Loadable<string>>({
		key: `fast`,
		default: () => serverValue({ key: `fast`, server: () => `ready` }),
	})
	const Slow: Island = () => {
		const value = useLoadable(slowAtom, ``)
		return <p>{value().value}</p>
	}
	const Fast: Island = () => {
		const value = useLoadable(fastAtom, ``)
		return <p>{value().value}</p>
	}
	const request = new Request(`http://test/streaming`)
	try {
		const slow = render(Slow, request)
		await started.promise
		const fast = await render(Fast, request)
		expect(fast.html).toContain(`ready`)
		expect(seedOf(fast).values).toEqual([[`fast`, [1, `ready`]]])
		pending.resolve(`finished`)
		expect(seedOf(await slow).values).toHaveLength(2)
	} finally {
		requestApplication(request).application.dispose()
	}
})

it(`keeps explicit collections authoritative and carries their cached seeds into later islands`, async () => {
	const stockAtom = atom<Loadable<string>>({
		key: `stock`,
		default: () => serverValue({ key: `stock`, server: () => `explicit stock` }),
	})
	const extraAtom = atom<Loadable<string>>({
		key: `extra`,
		default: () =>
			serverValue({ key: `extra`, server: () => `automatic stock` }),
	})
	const App: Island = () => {
		const value = useLoadable(stockAtom, ``)
		return <p>{value().value}</p>
	}
	const Later: Island = () => {
		const stock = useLoadable(stockAtom, ``),
			extra = useLoadable(extraAtom, ``)
		return (
			<p>
				{stock().value}
				{extra().value}
			</p>
		)
	}
	const request = new Request(`http://test/explicit`)
	try {
		const explicit = await collect(() => render(App, request))
		expect(seedOf(explicit.value)).toEqual(explicit.payload)
		const later = await render(Later, request)
		expect(seedOf(later).values).toEqual([
			[`stock`, [1, `explicit stock`]],
			[`extra`, [1, `automatic stock`]],
		])
		// Even another explicit boundary must retain the shared store's earlier seeds.
		const reused = await collect(() => render(Later, request))
		expect(reused.payload.values).toEqual([])
		expect(seedOf(reused.value)).toEqual(seedOf(later))
		App.prepareStore = (store) => {
			resetInStore(store, stockAtom)
		}
		const reset = await collect(() => render(App, request))
		expect(reset.payload.values).toEqual([[`stock`, [1, `explicit stock`]]])
		expect(seedOf(reset.value)).toEqual(seedOf(later))
	} finally {
		requestApplication(request).application.dispose()
	}
})

it(`isolates automatic collections across requests and private islands, including renderer use without an Astro request`, async () => {
	let next = 0
	const stockAtom = atom<Loadable<number>>({
		key: `stock`,
		default: () => serverValue({ key: `stock`, server: () => ++next }),
	})
	const App: Island = () => {
		const value = useLoadable(stockAtom, 0)
		return <p>{value().value}</p>
	}
	const a = new Request(`http://test/a`),
		b = new Request(`http://test/b`)
	try {
		const first = await render(App, a),
			other = await render(App, b)
		expect(seedOf(first).values).toEqual([[`stock`, [1, 1]]])
		expect(seedOf(other).values).toEqual([[`stock`, [1, 2]]])
		App.isolate = true
		expect(seedOf(await render(App, a)).values).toEqual([[`stock`, [1, 3]]])
		const standalone = await server.renderToStaticMarkup.call(
			{} as any,
			App,
			{},
			{},
		)
		expect(seedOf(standalone).values).toEqual([[`stock`, [1, 4]]])
		const model = new Silo({
			name: `custom`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const customAtom = model.atom<Loadable<number>>({
			key: `custom`,
			default: () => serverValue({ key: `stock`, server: () => 5 }),
		})
		const Custom: Island = () => {
			const value = useLoadable(customAtom, 0)
			return <p>{value().value}</p>
		}
		Custom.createStore = () => model.store
		expect(seedOf(await render(Custom, a)).values).toEqual([[`stock`, [1, 5]]])
	} finally {
		requestApplication(a).application.dispose()
		requestApplication(b).application.dispose()
	}
})
