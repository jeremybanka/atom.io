import {
	atom,
	atomFamily,
	disposeState,
	getState,
	runTransaction,
	selector,
	selectorFamily,
	setState,
	transaction,
} from "atom.io"
import {
	clearStore,
	getFromStore,
	IMPLICIT,
	setIntoStore,
	Store,
} from "atom.io/internal"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { browserApplication } from "../src/astro-application.ts"
import astroClient from "../src/astro-client.ts"
import { onRequest } from "../src/astro-middleware.ts"
import { requestApplication } from "../src/astro-request.ts"
import astroServer from "../src/astro-server.ts"
import type { AstroStoreContext, Island } from "../src/astro-shared.ts"
import { useValue } from "../src/core.ts"

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
const client = (host: HTMLElement, App: Island, directive = `load`) =>
	astroClient(host)(App, {}, {}, { client: directive })
const server = (request: Request, App: Island) =>
	astroServer.renderToStaticMarkup.call(
		{ result: { request } } as any,
		App,
		{},
		{},
	)
const nextResponse = (
	request: Request,
	next: () => Response | Promise<Response>,
) =>
	onRequest({ request } as any, () =>
		Promise.resolve(next()),
	) as Promise<Response>

it(`shares the normal atom.io graph, hydrates an initial root, and freshly mounts a delayed root after an edit`, async () => {
	const countAtom = atom<number>({ key: `count`, default: 0 })
	const App: Island = () => {
		const count = useValue(countAtom)
		return <p>{count()}</p>
	}
	const request = new Request(`http://test`)
	const html = (await server(request, App)).html
	const a = document.createElement(`div`),
		b = document.createElement(`div`)
	a.innerHTML = html
	b.innerHTML = html
	const aNode = a.querySelector(`p`),
		bNode = b.querySelector(`p`)
	await client(a, App)
	expect(a.querySelector(`p`)).toBe(aNode)
	setState(countAtom, 1)
	await Promise.resolve()
	await client(b, App, `visible`)
	expect(b.querySelector(`p`)).not.toBe(bNode)
	expect([a.textContent, b.textContent]).toEqual([`1`, `1`])
	a.dispatchEvent(new Event(`astro:unmount`))
	setState(countAtom, 2)
	await Promise.resolve()
	expect(b.textContent).toBe(`2`)
	expect(getState(countAtom)).toBe(2)
	requestApplication(request).application.dispose()
})

it(`hydrates two untouched initial roots and preserves a mounted root across navigation`, async () => {
	const countAtom = atom<number>({ key: `count`, default: 0 })
	const App: Island = () => {
		const count = useValue(countAtom)
		return <p>{count()}</p>
	}
	const req = new Request(`http://test`)
	const html = (await server(req, App)).html
	const a = document.createElement(`div`),
		b = document.createElement(`div`)
	a.innerHTML = html
	b.innerHTML = html
	const first = a.querySelector(`p`),
		second = b.querySelector(`p`)
	await client(a, App)
	await client(b, App, `visible`)
	expect(a.querySelector(`p`)).toBe(first)
	expect(b.querySelector(`p`)).toBe(second)
	document.dispatchEvent(new Event(`astro:before-swap`))
	await client(a, App)
	expect(a.querySelector(`p`)).toBe(first)
	const c = document.createElement(`div`)
	c.innerHTML = html
	const old = c.querySelector(`p`)
	await client(c, App)
	expect(c.querySelector(`p`)).not.toBe(old)
	requestApplication(req).application.dispose()
})

it(`notices edits during async preparation and mutations before bootstrap`, async () => {
	const valueAtom = atom<number>({ key: `value`, default: 0 })
	const App: Island = () => {
		const value = useValue(valueAtom)
		return <p>{value()}</p>
	}
	const req = new Request(`http://test`)
	const html = (await server(req, App)).html
	const wait = Promise.withResolvers<void>()
	App.prepareStore = () => wait.promise
	const host = document.createElement(`div`)
	host.innerHTML = html
	const old = host.querySelector(`p`)
	const ready = client(host, App)
	await Promise.resolve()
	setState(valueAtom, 2)
	wait.resolve()
	await ready
	expect(host.querySelector(`p`)).not.toBe(old)
	expect(host.textContent).toBe(`2`)
	browserApplication(document).dispose()
	expect(browserApplication(document).canResume).toBe(false)
	requestApplication(req).application.dispose()
})

it(`observes lazy families, transactions, disposal, selectors, and async resolution`, async () => {
	const app = browserApplication(document)
	const valuesAtoms = atomFamily<number, number>({ key: `values`, default: 0 })
	setState(valuesAtoms, 1, 3)
	expect(app.canResume).toBe(false)
	disposeState(valuesAtoms, 1)
	const derivedSelectors = selectorFamily<number, number>({
		key: `derived`,
		get: (id) => () => id,
	})
	getState(derivedSelectors, 1)
	disposeState(derivedSelectors, 1)
	app.dispose()
	clearStore(IMPLICIT.STORE)
	const fresh = browserApplication(document)
	const valueAtom = atom<number>({ key: `value`, default: 0 })
	const derivedSelector = selector<number>({
		key: `derived`,
		get: ({ get }) => get(valueAtom) + 1,
	})
	getState(derivedSelector)
	const changeTransaction = transaction({
		key: `change`,
		do: ({ set }) => {
			set(valueAtom, 1)
		},
	})
	runTransaction(changeTransaction)()
	expect(fresh.canResume).toBe(false)
	disposeState(valueAtom)
	fresh.dispose()
	clearStore(IMPLICIT.STORE)
	const asyncApp = browserApplication(document)
	const pending = Promise.withResolvers<number>()
	const asyncAtom = atom<Promise<number> | number>({
		key: `async`,
		default: () => pending.promise,
	})
	const result = getState(asyncAtom)
	expect(asyncApp.canResume).toBe(true)
	pending.resolve(3)
	await result
	expect(asyncApp.canResume).toBe(false)
})

it(`keeps the app alive in bfcache and releases app resources on a real page exit`, () => {
	const app = browserApplication(document)
	const create = vi.fn(() => ({ value: 1 })),
		cleanup = vi.fn()
	expect(app.get(create, create)).toBe(app.get(create, create))
	expect(create).toHaveBeenCalledOnce()
	expect(() =>
		app.get(`failure`, () => {
			throw new Error(`init`)
		}),
	).toThrow(`init`)
	expect(app.get(`failure`, () => 2)).toBe(2)
	app.onCleanup(cleanup)
	const cached = new Event(`pagehide`)
	Object.defineProperty(cached, `persisted`, { value: true })
	window.dispatchEvent(cached)
	expect(cleanup).not.toHaveBeenCalled()
	const exit = new Event(`pagehide`)
	Object.defineProperty(exit, `persisted`, { value: false })
	window.dispatchEvent(exit)
	expect(cleanup).toHaveBeenCalledOnce()
	expect(() => app.get(`late`, () => 1)).toThrow()
})

it(`explicit isolation retains separate stores`, async () => {
	const countAtom = atom<number>({ key: `count`, default: 0 })
	const App: Island = () => {
		const value = useValue(countAtom)
		return <p>{value()}</p>
	}
	App.isolate = true
	const a = document.createElement(`div`),
		b = document.createElement(`div`)
	await client(a, App, `only`)
	await client(b, App, `only`)
	setState(countAtom, 9)
	await Promise.resolve()
	expect([a.textContent, b.textContent]).toEqual([`0`, `0`])
	a.dispatchEvent(new Event(`astro:unmount`))
	b.dispatchEvent(new Event(`astro:unmount`))
	const req = new Request(`http://test`)
	await server(req, App)
})

it(`shares SSR state within a request and isolates overlapping requests and later imported definitions`, async () => {
	const valueAtom = atom<number>({ key: `value`, default: 0 })
	const App: Island = () => {
		const value = useValue(valueAtom)
		return <p>{value()}</p>
	}
	const a = new Request(`http://test/a`),
		b = new Request(`http://test/b`)
	const first = requestApplication(a),
		second = requestApplication(b)
	setIntoStore(first.store, valueAtom, 1)
	setIntoStore(second.store, valueAtom, 2)
	const [one, two] = await Promise.all([server(a, App), server(b, App)])
	expect(one.html).toContain(`1`)
	expect(two.html).toContain(`2`)
	expect((await server(a, App)).html).toContain(`1`)
	const laterAtom = atom<number>({ key: `later`, default: 3 })
	expect(getFromStore(first.store, laterAtom)).toBe(3)
	expect(getState(valueAtom)).toBe(0)
	first.application.dispose()
	second.application.dispose()
})

it(`holds request resources through streaming and releases effects at EOF`, async () => {
	const cleanup = vi.fn()
	const valueAtom = atom<number>({
		key: `value`,
		default: 1,
		effects: [() => cleanup],
	})
	const request = new Request(`http://test`)
	const owned = requestApplication(request)
	getFromStore(owned.store, valueAtom)
	const disposeResource = vi.fn()
	owned.store.miscResources.set(`resource`, {
		[Symbol.dispose]: disposeResource,
	})
	const encoder = new TextEncoder()
	const response = await nextResponse(
		request,
		() =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(encoder.encode(`hello`))
						controller.close()
					},
				}),
				{ status: 201, headers: { "x-test": `yes` } },
			),
	)
	expect(response.status).toBe(201)
	expect(response.headers.get(`x-test`)).toBe(`yes`)
	expect(await response.text()).toBe(`hello`)
	expect(owned.application.signal.aborted).toBe(true)
	expect(cleanup).toHaveBeenCalledOnce()
	expect(disposeResource).toHaveBeenCalledOnce()
})

it(`handles empty responses, failed requests, stream failures, cancellation, and cleanup errors`, async () => {
	const empty = new Request(`http://test/empty`),
		emptyApp = requestApplication(empty)
	await nextResponse(empty, () => new Response(null, { status: 204 }))
	expect(emptyApp.application.signal.aborted).toBe(true)
	const fail = new Request(`http://test/fail`),
		failure = requestApplication(fail)
	await expect(
		nextResponse(fail, () => Promise.reject(new Error(`next`))),
	).rejects.toThrow(`next`)
	expect(failure.application.signal.aborted).toBe(true)
	const streaming = new Request(`http://test/stream`),
		streamApp = requestApplication(streaming)
	const broken = await nextResponse(
		streaming,
		() =>
			new Response(
				new ReadableStream({
					pull() {
						throw new Error(`stream`)
					},
				}),
			),
	)
	await expect(broken.text()).rejects.toThrow(`stream`)
	expect(streamApp.application.signal.aborted).toBe(true)
	const cancelled = new Request(`http://test/cancel`),
		cancelApp = requestApplication(cancelled),
		cancel = vi.fn()
	const response = await nextResponse(
		cancelled,
		() => new Response(new ReadableStream({ cancel })),
	)
	await response.body!.cancel(`cancel`)
	expect(cancel).toHaveBeenCalledWith(`cancel`)
	expect(cancelApp.application.signal.aborted).toBe(true)
	const bad = new Request(`http://test/cleanup`),
		badApp = requestApplication(bad)
	const badAtom = atom<number>({
		key: `bad`,
		default: 0,
		effects: [
			() => () => {
				throw new Error(`effect cleanup`)
			},
		],
	})
	getFromStore(badApp.store, badAtom)
	badApp.store.miscResources.set(`bad`, {
		[Symbol.dispose]() {
			throw new Error(`resource cleanup`)
		},
	})
	expect(() => {
		badApp.application.dispose()
	}).toThrow(AggregateError)
	const controller = new AbortController()
	controller.abort()
	const aborted = requestApplication(
		new Request(`http://test/abort`, { signal: controller.signal }),
	)
	expect(aborted.application.signal.aborted).toBe(true)
})

it(`keeps a shared preparation alive when one waiting island unmounts`, async () => {
	const pending = Promise.withResolvers<void>()
	const initialized = vi.fn(() => pending.promise)
	const cleanup = vi.fn()
	const contexts: AstroStoreContext[] = []
	const App: Island = () => <p>ready</p>
	App.prepareStore = async (_store, _props, context) => {
		contexts.push(context)
		context.application.onCleanup(cleanup)
		await context.application.get(initialized, initialized)
	}
	const a = document.createElement(`div`),
		b = document.createElement(`div`)
	const first = client(a, App, `only`),
		second = client(b, App, `only`)
	await Promise.resolve()
	await Promise.resolve()
	await Promise.resolve()
	expect(initialized).toHaveBeenCalledOnce()
	a.dispatchEvent(new Event(`astro:unmount`))
	await first
	expect(contexts[0].signal.aborted).toBe(true)
	expect(contexts[0].application.signal.aborted).toBe(false)
	expect(cleanup).not.toHaveBeenCalled()
	pending.resolve()
	await second
	expect(a.childNodes.length).toBe(0)
	expect(b.textContent).toBe(`ready`)
	browserApplication(document).dispose()
	expect(contexts[1].signal.aborted).toBe(true)
	expect(b.childNodes.length).toBe(0)
	expect(cleanup).toHaveBeenCalledOnce()
})

it(`cancels pending SSR preparation with its request and cannot recreate a closed request store`, async () => {
	const controller = new AbortController()
	const request = new Request(`http://test/pending`, {
		signal: controller.signal,
	})
	const app = requestApplication(request)
	const App: Island = () => <p>never rendered</p>
	const entered = Promise.withResolvers<void>()
	App.prepareStore = (_store, _props, { signal }) =>
		new Promise((_resolve, reject) => {
			signal.addEventListener(
				`abort`,
				() => {
					reject(signal.reason)
				},
				{
					once: true,
				},
			)
			entered.resolve()
		})
	const rendering = server(request, App)
	await entered.promise
	controller.abort()
	await expect(rendering).rejects.toThrow()
	expect(requestApplication(request)).toBe(app)
	expect(() => app.store).toThrow()
	await expect(server(request, App)).rejects.toThrow()
})

it(`treats shared client-only initialization as live state before another island hydrates`, async () => {
	let initial = 0
	const valueAtom = atom<number>({ key: `value`, default: () => initial })
	const App: Island = () => {
		const value = useValue(valueAtom)
		return <p>{value()}</p>
	}
	const request = new Request(`http://test/client-only`)
	const html = (await server(request, App)).html
	initial = 7
	const only = document.createElement(`div`),
		later = document.createElement(`div`)
	later.innerHTML = html
	const original = later.querySelector(`p`)
	await client(only, App, `only`)
	await client(later, App, `visible`)
	expect(later.querySelector(`p`)).not.toBe(original)
	expect([only.textContent, later.textContent]).toEqual([`7`, `7`])
	requestApplication(request).application.dispose()
})
