import { Silo } from "atom.io"
import { expect, it, vi } from "vitest"

import type { Capability } from "../src/index.ts"
import { hydrate, render, useGetter } from "../src/index.ts"
import { renderToString } from "../src/server.ts"

it(`keeps capabilities root-scoped, updates them reactively, and never emits their attributes`, () => {
	const silo = new Silo({
		name: `capabilities`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const valueAtom = silo.atom<number>({ key: `value`, default: 1 })
	const update = vi.fn()
	const cleanup = vi.fn()
	const capability: Capability = {
		namespace: `demo`,
		attach: () => ({ update, dispose: cleanup }),
	}
	function App() {
		const getValue = useGetter(valueAtom)
		return (
			<custom-panel {...{ "demo:value": getValue() }} data-value={getValue()} />
		)
	}
	const options = { store: silo.store, capabilities: [capability] }
	const html = renderToString(() => <App />, options)
	expect(html).not.toContain(`demo:`)
	expect(update).not.toHaveBeenCalled()
	const host = document.createElement(`div`)
	host.innerHTML = html
	const element = host.querySelector(`custom-panel`)!
	const root = hydrate(() => <App />, host, options)
	expect(host.querySelector(`custom-panel`)).toBe(element)
	expect(update).toHaveBeenLastCalledWith({ value: 1 })
	silo.setState(valueAtom, 2)
	root.flush()
	expect(update).toHaveBeenLastCalledWith({ value: 2 })
	expect(element.getAttribute(`data-value`)).toBe(`2`)
	root.dispose()
	expect(cleanup).toHaveBeenCalledTimes(1)
	expect(() => render(() => <App />, host, { store: silo.store })).toThrow(
		`not registered`,
	)
	expect(() => renderToString(() => <App />, { store: silo.store })).toThrow(
		`not registered`,
	)
	expect(() =>
		render(() => null, host, { capabilities: [capability, capability] }),
	).toThrow(`duplicate capability`)
})

it(`releases a capability binding when its attributes disappear`, () => {
	const silo = new Silo({
		name: `capability-removal`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const enabledAtom = silo.atom<boolean>({ key: `enabled`, default: true })
	const cleanup = vi.fn()
	const capability: Capability = {
		namespace: `demo`,
		attach: () => ({ update() {}, dispose: cleanup }),
	}
	function App() {
		const getEnabled = useGetter(enabledAtom)
		return <custom-panel {...(getEnabled() ? { "demo:value": 1 } : {})} />
	}
	const host = document.createElement(`div`)
	const root = render(() => <App />, host, {
		store: silo.store,
		capabilities: [capability],
	})
	silo.setState(enabledAtom, false)
	root.flush()
	expect(cleanup).toHaveBeenCalledTimes(1)
	root.dispose()
	expect(cleanup).toHaveBeenCalledTimes(1)
})

it(`inherits island capabilities through Astro SSR and hydration`, async () => {
	const { default: server } = await import(`../src/astro-server.ts`)
	const { default: client } = await import(`../src/astro-client.ts`)
	const update = vi.fn()
	const cleanup = vi.fn()
	function App() {
		return <custom-panel {...{ "demo:value": 1 }} />
	}
	App.spa = true
	App.isolate = true
	App.capabilities = [
		{ namespace: `demo`, attach: () => ({ update, dispose: cleanup }) },
	]
	const rendered = await server.renderToStaticMarkup.call({} as any, App, {}, {})
	expect(rendered.html).not.toContain(`demo:`)
	const host = document.createElement(`section`)
	host.innerHTML = rendered.html
	const element = host.querySelector(`custom-panel`)
	await client(host)(App, {}, {}, { client: `load` })
	expect(host.querySelector(`custom-panel`)).toBe(element)
	expect(update).toHaveBeenCalledWith({ value: 1 })
	host.dispatchEvent(new Event(`astro:unmount`))
	expect(cleanup).toHaveBeenCalledTimes(1)
})

it(`preserves XML attribute namespaces and aggregates independent capability cleanup failures`, () => {
	const host = document.createElement(`div`)
	const one = vi.fn(() => {
		throw new Error(`one`)
	})
	const two = vi.fn(() => {
		throw new Error(`two`)
	})
	const capabilities = [
		{ namespace: `one`, attach: () => ({ update() {}, dispose: one }) },
		{ namespace: `two`, attach: () => ({ update() {}, dispose: two }) },
	]
	const root = render(
		() => (
			<svg>
				<use xlink:href="#shape" {...{ "one:value": 1, "two:value": 2 }} />
			</svg>
		),
		host,
		{ capabilities },
	)
	expect(host.querySelector(`use`)!.getAttribute(`xlink:href`)).toBe(`#shape`)
	expect(() => {
		root.dispose()
	}).toThrow(AggregateError)
	expect(one).toHaveBeenCalledOnce()
	expect(two).toHaveBeenCalledOnce()
	expect(
		renderToString(() => (
			<svg>
				<use xlink:href="#shape" />
			</svg>
		)),
	).toContain(`xlink:href="#shape"`)
})
