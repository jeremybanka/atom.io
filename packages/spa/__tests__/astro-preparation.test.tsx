import { atom, Silo } from "atom.io"
import { describe, expect, it, vi } from "vitest"

import astroClient from "../src/astro-client.ts"
import { storeContext } from "../src/astro-context.ts"
import astroServer from "../src/astro-server.ts"
import type { AstroStoreContext, Island } from "../src/astro-shared.ts"
import { onCleanup, useValue } from "../src/core.ts"

const silo = (): Silo =>
	new Silo({
		name: `prepared-island`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
const ssr = (component: Island) =>
	astroServer.renderToStaticMarkup.call({} as any, component, {}, {})

describe(`Astro store preparation`, () => {
	it(`awaits server preparation before rendering and releases its resources afterward`, async () => {
		const model = silo()
		const valueAtom = model.atom<string>({ key: `value`, default: `loading` })
		const pending = Promise.withResolvers<void>()
		const cleaned = vi.fn()
		let context!: AstroStoreContext
		const setup = vi.fn()
		const App: Island = () => {
			setup()
			const value = useValue(valueAtom)
			return <p>{value()}</p>
		}
		App.createStore = async (_, next) => {
			context = next
			next.onCleanup(cleaned)
			await pending.promise
			model.setState(valueAtom, `ready`)
			return model.store
		}
		const rendering = ssr(App)
		expect(setup).not.toHaveBeenCalled()
		expect(context.element).toBeUndefined()
		expect(context.signal.aborted).toBe(false)
		pending.resolve()
		expect((await rendering).html).toContain(`ready`)
		expect(setup).toHaveBeenCalledOnce()
		expect(context.signal.aborted).toBe(true)
		expect(cleaned).toHaveBeenCalledOnce()
	})

	it.each([`sync`, `async`, `render`])(
		`releases server resources after a %s failure`,
		async (failure) => {
			const cleaned = vi.fn()
			const App: Island = () => {
				throw new Error(`render`)
			}
			App.createStore = (_, context) => {
				context.onCleanup(cleaned)
				if (failure === `sync`) throw new Error(`sync`)
				if (failure === `async`) return Promise.reject(new Error(`async`))
				return silo().store
			}
			await expect(ssr(App)).rejects.toThrow(failure)
			expect(cleaned).toHaveBeenCalledOnce()
		},
	)

	it(`runs all cleanups once, immediately releases late resources, and preserves preparation failures`, async () => {
		const lifetime = storeContext()
		const order: number[] = []
		lifetime.context.onCleanup(() => {
			order.push(1)
		})
		lifetime.context.onCleanup(() => {
			order.push(2)
			throw new Error(`cleanup`)
		})
		expect(() => {
			lifetime.dispose()
		}).toThrow(AggregateError)
		lifetime.dispose()
		lifetime.context.onCleanup(() => {
			order.push(3)
		})
		expect(order).toEqual([2, 1, 3])
		await expect(lifetime.cancelled).resolves.toBeUndefined()
		const App: Island = () => null
		App.createStore = (_, context) => {
			context.onCleanup(() => {
				throw new Error(`cleanup`)
			})
			throw new Error(`preparation`)
		}
		await expect(ssr(App)).rejects.toMatchObject({
			errors: [
				expect.objectContaining({ message: `preparation` }),
				expect.any(AggregateError),
			],
		})
	})

	it(`prepares one browser store and applies the latest props while preparation is pending`, async () => {
		const model = silo()
		const pending = Promise.withResolvers<void>()
		const cleanup = vi.fn()
		let context!: AstroStoreContext
		const App: Island = (props) => (
			<p>
				{props.label}
				{props.children}
			</p>
		)
		App.createStore = vi.fn(async (_, next) => {
			context = next
			next.onCleanup(cleanup)
			await pending.promise
			return model.store
		})
		const host = document.createElement(`div`)
		host.innerHTML = `fallback`
		const hydrate = astroClient(host)
		const first = hydrate(App, { label: `old` }, {}, { client: `only` })
		await Promise.resolve()
		expect(context.element).toBe(host)
		expect(context.signal.aborted).toBe(false)
		expect(host.textContent).toBe(`fallback`)
		const second = hydrate(
			App,
			{ label: `new` },
			{ default: `<b>slot</b>` },
			{ client: `only` },
		)
		pending.resolve()
		await Promise.all([first, second])
		expect(App.createStore).toHaveBeenCalledOnce()
		expect(host.textContent).toBe(`newslot`)
		await hydrate(App, { label: `updated` }, {}, { client: `load` })
		expect(host.textContent).toBe(`updated`)
		expect(App.createStore).toHaveBeenCalledOnce()
		host.dispatchEvent(new Event(`astro:unmount`))
		expect(context.signal.aborted).toBe(true)
		expect(cleanup).toHaveBeenCalledOnce()
		expect(host.childNodes.length).toBe(0)
		expect(
			[...model.store.atoms.keys()].some((key) =>
				key.startsWith(`🔍 spa islands`),
			),
		).toBe(false)
	})

	it(`hydrates the original server structure before applying props changed during preparation`, async () => {
		const App: Island = (props) => (
			<div>{props.expanded ? <section>expanded</section> : <p>initial</p>}</div>
		)
		const markup = await ssr(App)
		const host = document.createElement(`div`)
		host.innerHTML = markup.html
		const pending = Promise.withResolvers<void>()
		App.createStore = async () => {
			await pending.promise
			return silo().store
		}
		const hydrate = astroClient(host)
		const first = hydrate(App, { expanded: false }, {}, { client: `load` })
		await Promise.resolve()
		const second = hydrate(App, { expanded: true }, {}, { client: `load` })
		pending.resolve()
		await Promise.all([first, second])
		expect(host.querySelector(`section`)?.textContent).toBe(`expanded`)
		expect(host.querySelector(`p`)).toBeNull()
		host.dispatchEvent(new Event(`astro:unmount`))
	})

	it(`does not start a factory cancelled before its first microtask`, async () => {
		const App: Island = () => <p>unused</p>
		App.createStore = vi.fn(() => silo().store)
		const host = document.createElement(`div`)
		const ready = astroClient(host)(App, {}, {}, { client: `only` })
		host.dispatchEvent(new Event(`astro:unmount`))
		await ready
		expect(App.createStore).not.toHaveBeenCalled()
	})

	it.each([`resolve`, `reject`])(
		`cancels a pending browser factory even if it later ${`%s`}s`,
		async (settlement) => {
			const pending = Promise.withResolvers<void>()
			const late = vi.fn()
			let context!: AstroStoreContext
			const App: Island = () => <p>stale</p>
			App.createStore = async (_, next) => {
				context = next
				await pending.promise
				next.onCleanup(late)
				return silo().store
			}
			const host = document.createElement(`div`)
			const ready = astroClient(host)(App, {}, {}, { client: `only` })
			await Promise.resolve()
			host.dispatchEvent(new Event(`astro:unmount`))
			await ready
			expect(context.signal.aborted).toBe(true)
			if (settlement === `resolve`) pending.resolve()
			else pending.reject(new Error(`late`))
			await Promise.resolve()
			await Promise.resolve()
			expect(late).toHaveBeenCalledTimes(settlement === `resolve` ? 1 : 0)
			expect(host.childNodes.length).toBe(0)
		},
	)

	it(`ignores rejection queued just before cancellation`, async () => {
		const pending = Promise.withResolvers<ReturnType<typeof silo>[`store`]>()
		const App: Island = () => null
		App.createStore = () => pending.promise
		const host = document.createElement(`div`)
		const ready = astroClient(host)(App, {}, {}, { client: `only` })
		await Promise.resolve()
		pending.reject(new Error(`cancelled`))
		await Promise.resolve()
		host.dispatchEvent(new Event(`astro:unmount`))
		await expect(ready).resolves.toBeUndefined()
	})

	it(`a superseded factory cannot overwrite or release the replacement island`, async () => {
		const pending = Promise.withResolvers<void>()
		const cleanup = vi.fn()
		const A: Island = () => <p>old</p>
		A.createStore = async (_, context) => {
			context.onCleanup(cleanup)
			await pending.promise
			return silo().store
		}
		const B: Island = () => <p>new</p>
		const host = document.createElement(`div`)
		const hydrate = astroClient(host)
		host.innerHTML = `<p>stale server HTML</p>`
		const first = hydrate(A, {}, {}, { client: `load` })
		await Promise.resolve()
		await hydrate(B, {}, {}, { client: `load` })
		pending.resolve()
		await first
		expect(host.textContent).toBe(`new`)
		expect(cleanup).toHaveBeenCalledOnce()
		host.dispatchEvent(new Event(`astro:unmount`))
		expect(host.childNodes.length).toBe(0)
	})

	it.each([`sync`, `async`, `render`, `hydrate`])(
		`cleans up browser ${`%s`} failures and permits a retry`,
		async (failure) => {
			const cleanup = vi.fn()
			const App: Island = () => {
				if (failure === `render`) throw new Error(`render`)
				return <p>ready</p>
			}
			App.createStore = (_, context) => {
				context.onCleanup(cleanup)
				if (failure === `sync`) throw new Error(`sync`)
				if (failure === `async`) return Promise.reject(new Error(`async`))
				return silo().store
			}
			const host = document.createElement(`div`)
			await expect(
				astroClient(host)(
					App,
					{},
					{},
					{ client: failure === `hydrate` ? `load` : `only` },
				),
			).rejects.toThrow()
			expect(cleanup).toHaveBeenCalledOnce()
			const Retry: Island = () => <p>retry</p>
			await astroClient(host)(Retry, {}, {}, { client: `only` })
			expect(host.textContent).toBe(`retry`)
			host.dispatchEvent(new Event(`astro:unmount`))
		},
	)

	it(`releases prepared resources when a mounted computation fails`, async () => {
		const model = silo()
		const failAtom = model.atom<boolean>({ key: `fail`, default: false })
		const cleanup = vi.fn()
		let context!: AstroStoreContext
		const App: Island = () => {
			const fail = useValue(failAtom)
			onCleanup(() => {
				expect(cleanup).not.toHaveBeenCalled()
			})
			return (
				<p>
					{fail()
						? (() => {
								throw new Error(`update`)
							})()
						: `ready`}
				</p>
			)
		}
		App.createStore = (_, next) => {
			context = next
			next.onCleanup(cleanup)
			return model.store
		}
		const host = document.createElement(`div`)
		await astroClient(host)(App, {}, {}, { client: `only` })
		// Trigger through live props so the renderer flushes synchronously.
		model.setState(failAtom, true)
		await expect(
			astroClient(host)(App, {}, {}, { client: `load` }),
		).rejects.toThrow(`update`)
		expect(cleanup).toHaveBeenCalledOnce()
		expect(context.signal.aborted).toBe(true)
	})
})

it(`prepares module definitions in separate default stores before SSR and hydration`, async () => {
	const valueAtom = atom<string>({
		key: `value`,
		default: () => `unprepared`,
	})
	const stores = new Set()
	const cleaned = vi.fn()
	const App: Island<{ message: string }> = () => {
		const value = useValue(valueAtom)
		return <p>{value()}</p>
	}
	App.prepareStore = async (store, props, context) => {
		stores.add(store)
		context.onCleanup(cleaned)
		await Promise.resolve()
		store.runDefault = () => props.message as any
	}
	const markup = await astroServer.renderToStaticMarkup.call(
		{} as any,
		App,
		{ message: `prepared` },
		{},
	)
	expect(markup.html).toContain(`prepared`)
	expect(cleaned).toHaveBeenCalledTimes(1)
	const host = document.createElement(`div`)
	host.innerHTML = markup.html
	const paragraph = host.querySelector(`p`)
	await astroClient(host)(App, { message: `prepared` }, {}, { client: `load` })
	expect(host.querySelector(`p`)).toBe(paragraph)
	expect(host.textContent).toBe(`prepared`)
	expect(stores.size).toBe(2)
	host.dispatchEvent(new Event(`astro:unmount`))
	expect(cleaned).toHaveBeenCalledTimes(2)
})

it(`cancels async preparation and releases its late resources`, async () => {
	const pending = Promise.withResolvers<void>()
	const cleaned = vi.fn()
	const mounted = vi.fn()
	const started = Promise.withResolvers<void>()
	const App: Island = () => {
		mounted()
		return null
	}
	App.prepareStore = async (_, __, context) => {
		started.resolve()
		await pending.promise
		context.onCleanup(cleaned)
	}
	const host = document.createElement(`div`)
	const hydration = astroClient(host)(App, {}, {}, { client: `only` })
	await started.promise
	host.dispatchEvent(new Event(`astro:unmount`))
	await hydration
	pending.resolve()
	await Promise.resolve()
	expect(cleaned).toHaveBeenCalledOnce()
	expect(mounted).not.toHaveBeenCalled()
})

it(`preserves factory stores and reports preparation failures with cleanup`, async () => {
	const model = silo()
	const cleaned = vi.fn()
	const App: Island = () => null
	App.createStore = () => model.store
	App.prepareStore = (store, _, context) => {
		expect(store).toBe(model.store)
		context.onCleanup(cleaned)
		throw new Error(`prepare failed`)
	}
	await expect(ssr(App)).rejects.toThrow(`prepare failed`)
	expect(cleaned).toHaveBeenCalledOnce()
})
