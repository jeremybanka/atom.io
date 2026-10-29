import type { Loadable } from "atom.io"
import { Silo } from "atom.io"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Accessor, HydrogenRoot } from "../src/index.ts"
import { render, useLoadable } from "../src/index.ts"
import { renderToString } from "../src/server.ts"

const roots: HydrogenRoot[] = []
afterEach(() => {
	for (const root of roots.splice(0)) root.dispose()
	document.body.replaceChildren()
})
function fixture() {
	const silo = new Silo({
		name: `loadable`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const host = document.createElement(`section`)
	document.body.append(host)
	const mount = (setup: Parameters<typeof render>[0]) => {
		const root = render(setup, host, { store: silo.store })
		roots.push(root)
		return root
	}
	return { silo, host, mount }
}
async function settle(root: HydrogenRoot): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0))
	root.flush()
}

describe(`useLoadable`, () => {
	it(`tracks initial loading, fulfillment and refresh without rerunning setup`, async () => {
		const { silo, host, mount } = fixture()
		const first = Promise.withResolvers<string>()
		const valueAtom = silo.atom<Loadable<string>>({
			key: `value`,
			default: () => first.promise,
		})
		const setups = vi.fn()
		let read!: Accessor<`LOADING` | { loading: boolean; value: string }>
		function App() {
			setups()
			read = useLoadable(valueAtom)
			return (
				<output>
					{() => {
						const result = read()
						return result === `LOADING`
							? `loading`
							: `${result.loading}:${result.value}`
					}}
				</output>
			)
		}
		const root = mount(() => <App />)
		expect(host.textContent).toBe(`loading`)
		first.resolve(`first`)
		await settle(root)
		expect(host.textContent).toBe(`false:first`)
		const refresh = Promise.withResolvers<string>()
		silo.setState(valueAtom, refresh.promise)
		root.flush()
		expect(read()).toEqual({ loading: true, value: `first` })
		expect(host.textContent).toBe(`true:first`)
		refresh.resolve(`second`)
		await settle(root)
		expect(host.textContent).toBe(`false:second`)
		expect(setups).toHaveBeenCalledOnce()
		root.dispose()
		expect(silo.store.atoms.get(valueAtom.key)!.subject.subscribers.size).toBe(0)
	})

	it(`returns a fallback and handles rejected values through the token's catch declaration`, async () => {
		const { silo, host, mount } = fixture()
		const deferred = Promise.withResolvers<string>()
		const valueAtom = silo.atom<Loadable<string>, Error>({
			key: `value`,
			default: () => deferred.promise,
			catch: [Error],
		})
		let read!: Accessor<{ loading: boolean; value: string; error?: Error }>
		const root = mount(() => {
			read = useLoadable(valueAtom, `fallback`)
			return (
				<output>
					{read().value}:{read().loading}:{read().error?.message}
				</output>
			)
		})
		expect(read()).toEqual({ loading: true, value: `fallback` })
		const error = new Error(`failed`)
		deferred.reject(error)
		await settle(root)
		expect(read()).toEqual({ loading: false, value: `fallback`, error })
		expect(host.textContent).toContain(`failed`)
		const retry = Promise.withResolvers<string>()
		silo.setState(valueAtom, retry.promise)
		root.flush()
		expect(read()).toEqual({ loading: true, value: `fallback`, error })
		retry.resolve(`recovered`)
		await settle(root)
		expect(read()).toEqual({ loading: false, value: `recovered` })
		const refresh = Promise.withResolvers<string>()
		silo.setState(valueAtom, refresh.promise)
		root.flush()
		expect(read()).toEqual({ loading: true, value: `recovered` })
		refresh.resolve(`done`)
		await settle(root)
		expect(host.textContent).toBe(`done::`)
	})

	it(`does not treat an Error fallback as a rejection until the atom rejects`, async () => {
		const { silo, mount } = fixture()
		const deferred = Promise.withResolvers<Error>()
		const valueAtom = silo.atom<Loadable<Error>, Error>({
			key: `value`,
			default: () => deferred.promise,
			catch: [Error],
		})
		const fallback = new Error(`fallback`)
		let read!: Accessor<{ loading: boolean; value: Error; error?: Error }>
		const root = mount(() => {
			read = useLoadable(valueAtom, fallback)
			return <output>{read().error?.message}</output>
		})
		expect(read()).toEqual({ loading: true, value: fallback })
		deferred.reject(fallback)
		await settle(root)
		expect(read()).toEqual({ loading: false, value: fallback, error: fallback })
	})

	it(`exposes handled errors as values without a fallback and retains them during retries`, async () => {
		const { silo, mount } = fixture()
		const deferred = Promise.withResolvers<string>()
		const valueAtom = silo.atom<Loadable<string>, Error>({
			key: `value`,
			default: () => deferred.promise,
			catch: [Error],
		})
		let read!: Accessor<`LOADING` | { loading: boolean; value: string | Error }>
		const root = mount(() => {
			const loadable = useLoadable(valueAtom)
			// Keep the accessor subscribed through a DOM computation.
			read = loadable
			return <output>{JSON.stringify(loadable())}</output>
		})
		const error = new Error(`failed`)
		deferred.reject(error)
		await settle(root)
		expect(read()).toEqual({ loading: false, value: error })
		silo.setState(valueAtom, new Promise<never>(() => {}))
		root.flush()
		expect(read()).toEqual({ loading: true, value: error })
	})

	it.each([null, undefined, `LOADING`, ``, false, 0])(
		`preserves a settled %s value during refresh`,
		(value) => {
			const { silo, mount } = fixture()
			const valueAtom = silo.atom<Loadable<typeof value>>({
				key: `value`,
				default: value,
			})
			let read!: () => unknown
			const root = mount(() => {
				read = useLoadable(valueAtom)
				return <output>{JSON.stringify(read())}</output>
			})
			expect(read()).toEqual({ loading: false, value })
			silo.setState(valueAtom, new Promise<never>(() => {}))
			root.flush()
			expect(read()).toEqual({ loading: true, value })
		},
	)

	it.each([null, undefined, `LOADING`, ``, false, 0])(
		`recognizes an explicit %s fallback`,
		(fallback) => {
			const { silo, mount } = fixture()
			const valueAtom = silo.atom<Loadable<typeof fallback>>({
				key: `value`,
				default: () => new Promise(() => {}),
			})
			let read!: () => unknown
			mount(() => {
				read = useLoadable(valueAtom, fallback)
				return <output>{JSON.stringify(read())}</output>
			})
			expect(read()).toEqual({ loading: true, value: fallback })
		},
	)

	it(`resolves atom and selector families in the root store`, async () => {
		const { silo, host, mount } = fixture()
		const deferred = Promise.withResolvers<number>()
		const valueAtoms = silo.atomFamily<Loadable<number>, number>({
			key: `value`,
			default: () => deferred.promise,
		})
		const derivedSelectors = silo.selectorFamily<Loadable<number>, number>({
			key: `derived`,
			get:
				(key) =>
				({ get }) =>
					get(valueAtoms, key),
		})
		const root = mount(() => {
			const a = useLoadable(valueAtoms, 1)
			const b = useLoadable(derivedSelectors, 2, 0)
			return (
				<output>
					{JSON.stringify(a())}:{b().value}
				</output>
			)
		})
		expect(host.textContent).toBe(`"LOADING":0`)
		deferred.resolve(7)
		await settle(root)
		expect(host.textContent).toBe(`{"loading":false,"value":7}:7`)
	})

	it(`uses isolated root stores even when tokens have the same key`, () => {
		const first = fixture()
		const second = fixture()
		const valueAtom = first.silo.atom<Loadable<string>>({
			key: `value`,
			default: `first`,
		})
		second.silo.atom<Loadable<string>>({ key: `value`, default: `second` })
		const App = () => {
			const read = useLoadable(valueAtom, `fallback`)
			return <output>{read().value}</output>
		}
		first.mount(() => <App />)
		second.mount(() => <App />)
		expect(first.host.textContent).toBe(`first`)
		expect(second.host.textContent).toBe(`second`)
	})

	it(`reads selectors and does not classify undeclared Error values as failures`, () => {
		const { silo, mount } = fixture()
		const value = new Error(`ordinary data`)
		const valueSelector = silo.selector<Error>({
			key: `value`,
			const: value,
			get: () => {},
		})
		let read!: () => unknown
		mount(() => {
			read = useLoadable(valueSelector, new Error(`fallback`))
			return <output>{JSON.stringify(read())}</output>
		})
		expect(read()).toEqual({ loading: false, value })
	})

	it(`renders loading state on the server without subscriptions or waiting`, () => {
		const { silo } = fixture()
		const valueAtom = silo.atom<Loadable<string>>({
			key: `value`,
			default: () => new Promise(() => {}),
		})
		const App = () => {
			const value = useLoadable(valueAtom, `pending`)
			return <output aria-busy={value().loading}>{value().value}</output>
		}
		expect(renderToString(() => <App />, { store: silo.store })).toContain(
			`aria-busy="true"`,
		)
		expect(silo.store.atoms.get(valueAtom.key)!.subject.subscribers.size).toBe(0)
	})

	it(`releases pending subscriptions when disposed before settlement`, async () => {
		const { silo, host, mount } = fixture()
		const deferred = Promise.withResolvers<string>()
		const valueAtom = silo.atom<Loadable<string>>({
			key: `value`,
			default: () => deferred.promise,
		})
		const root = mount(() => {
			const value = useLoadable(valueAtom, `pending`)
			return <output>{value().value}</output>
		})
		root.dispose()
		deferred.resolve(`late`)
		await settle(root)
		expect(host.childNodes).toHaveLength(0)
		expect(silo.store.atoms.get(valueAtom.key)!.subject.subscribers.size).toBe(0)
	})
})
