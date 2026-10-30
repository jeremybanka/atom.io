import { Silo } from "atom.io"
import { describe, expect, it, vi } from "vitest"

import astroClient from "../src/astro-client.ts"
import astroServer from "../src/astro-server.ts"
import type { Island } from "../src/astro-shared.ts"
import { compile } from "../src/compiler.ts"
import {
	hydrate,
	onCleanup,
	onMount,
	render,
	useRef,
	useValue,
} from "../src/index.ts"
import { renderToString } from "../src/server.ts"

describe(`integration contracts`, () => {
	it(`mounts new branches after updates, with refs available to mount callbacks`, () => {
		const silo = new Silo({
			name: `mount-test`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const visibleAtom = silo.atom<boolean>({ key: `visible`, default: false })
		const elementAtom = silo.atom<Element | null>({
			key: `element`,
			default: null,
		})
		const mounted = vi.fn()
		const cleaned = vi.fn()
		function Branch() {
			const ref = useRef(elementAtom)
			onMount(() => mounted(silo.getState(elementAtom)))
			onCleanup(cleaned)
			return <input ref={ref} />
		}
		function App() {
			const visible = useValue(visibleAtom)
			return <>{visible() && <Branch />}</>
		}
		const host = document.createElement(`section`)
		const root = render(() => <App />, host, { store: silo.store })
		silo.setState(visibleAtom, true)
		root.flush()
		expect(mounted).toHaveBeenCalledWith(host.querySelector(`input`))
		silo.setState(visibleAtom, false)
		root.flush()
		expect(cleaned).toHaveBeenCalledOnce()
		expect(silo.getState(elementAtom)).toBe(null)
		root.dispose()
	})
	it(`hydrates raw text and form controls and updates their values`, () => {
		const silo = new Silo({
			name: `form-test`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const textAtom = silo.atom<string>({ key: `text`, default: `<&` })
		function App() {
			const text = useValue(textAtom)
			return (
				<>
					<textarea value={text()} />
					<select value="b">
						<option value="a">A</option>
						<option value="b">B</option>
					</select>
					<title>{text()} title</title>
					<style>{`p { color: red }`}</style>
				</>
			)
		}
		const host = document.createElement(`section`)
		host.innerHTML = renderToString(() => <App />, { store: silo.store })
		const textarea = host.querySelector(`textarea`)!
		const select = host.querySelector(`select`)!
		expect(textarea.value).toBe(`<&`)
		expect(select.value).toBe(`b`)
		const root = hydrate(() => <App />, host, { store: silo.store })
		expect(host.querySelector(`textarea`)).toBe(textarea)
		silo.setState(textAtom, `next`)
		root.flush()
		expect(textarea.value).toBe(`next`)
		expect(host.querySelector(`title`)!.textContent).toBe(`next title`)
		root.dispose()
	})
	it(`shuts down a failed update and reports it once`, async () => {
		const silo = new Silo({
			name: `error-test`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const countAtom = silo.atom<number>({ key: `count`, default: 0 })
		const onError = vi.fn()
		const cleanup = vi.fn()
		function App() {
			const count = useValue(countAtom)
			onCleanup(cleanup)
			const read = () => {
				if (count() > 0) throw new Error(`failed read`)
				return count()
			}
			return <output>{read()}</output>
		}
		const host = document.createElement(`section`)
		const root = render(() => <App />, host, { store: silo.store, onError })
		silo.setState(countAtom, 1)
		await Promise.resolve()
		expect(onError).toHaveBeenCalledOnce()
		expect(cleanup).toHaveBeenCalledOnce()
		expect(host.childNodes.length).toBe(0)
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
		root.dispose()
	})
	it(`brands named and anonymous default components without branding nested callbacks`, () => {
		for (const source of [
			`export default () => <p>Hello</p>`,
			`export default function () { return <p>Hello</p> }`,
			`export function App() { return <p>Hello</p> }`,
			`export default function List() { return [1,2].map(n => <p>{n}</p>) }`,
		]) {
			const output = compile(source, `App.spa.tsx`)
			expect(output.code).toMatch(/\.spa = true/)
			expect(output.code).not.toContain(`<p>`)
			expect(output.map.sources).toContain(`App.spa.tsx`)
		}
	})
	it(`resolves lowercase JSX namespaces as JavaScript bindings`, () => {
		const ui = { Label: () => <label>namespaced</label> }
		const host = document.createElement(`section`)
		const root = render(() => <ui.Label />, host)
		expect(host.textContent).toBe(`namespaced`)
		root.dispose()
	})
	it(`preserves textarea leading newlines through the HTML parser`, () => {
		const host = document.createElement(`section`)
		const setup = () => <textarea>{`\nfirst line`}</textarea>
		host.innerHTML = renderToString(setup)
		expect(host.innerHTML).toContain(`<textarea>\n\nfirst line`)
		const root = hydrate(setup, host)
		expect(host.querySelector(`textarea`)!.value).toBe(`\nfirst line`)
		root.dispose()
	})
	it(`releases island state when hydration fails before component setup`, async () => {
		const silo = new Silo({
			name: `invalid-island`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const App: Island = () => <p>hello</p>
		App.createStore = () => silo.store
		const host = document.createElement(`section`)
		await expect(
			astroClient(host)(App, {}, {}, { client: `load` }),
		).rejects.toThrow()
		expect(
			[...silo.store.atoms.keys()].some((key) =>
				key.startsWith(`🔍 spa islands`),
			),
		).toBe(false)
	})
	it(`renders Astro slots, hydrates isolated stores, and disposes on astro:unmount`, async () => {
		const silo = new Silo({
			name: `astro-test`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const countAtom = silo.atom<number>({ key: `count`, default: 0 })
		const setup = vi.fn()
		const cleanup = vi.fn()
		const App: Island = (props) => {
			const count = useValue(countAtom)
			onCleanup(cleanup)
			setup()
			return (
				<article>
					{props.children}
					<output>
						{count()}
						{props.label}
					</output>
					{props.slots.heading}
				</article>
			)
		}
		App.spa = true
		const stores: Silo[] = []
		App.createStore = () => {
			const instance = new Silo(
				{ name: `island`, lifespan: `ephemeral`, isProduction: true },
				silo.store,
			)
			stores.push(instance)
			return instance.store
		}
		const props = {}
		const slots = { default: `<p>from Astro</p>`, heading: `<h2>Named</h2>` }
		expect(await astroServer.check.call({} as any, App, props, slots)).toBe(true)
		const rendered = await astroServer.renderToStaticMarkup.call(
			{} as any,
			App,
			props,
			slots,
		)
		const host = document.createElement(`section`)
		host.innerHTML = rendered.html + `<!--astro:end-->`
		expect(host.querySelector(`astro-slot[name="heading"]`)?.innerHTML).toBe(
			slots.heading,
		)
		const paragraph = host.querySelector(`p`)
		await astroClient(host)(App, props, slots, { client: `load` })
		expect(host.querySelector(`p`)).toBe(paragraph)
		expect(host.textContent).toBe(`from Astro0Named`)
		expect(setup).toHaveBeenCalledTimes(2)
		const output = host.querySelector(`output`)
		await astroClient(host)(App, { label: ` updated` }, slots, {
			client: `load`,
		})
		expect(host.querySelector(`p`)).toBe(paragraph)
		expect(host.querySelector(`output`)).toBe(output)
		expect(host.textContent).toBe(`from Astro0 updatedNamed`)
		await astroClient(host)(
			App,
			{ label: ` updated` },
			{ ...slots, default: `<p>new slot</p>` },
			{ client: `load` },
		)
		expect(host.querySelector(`p`)).not.toBe(paragraph)
		expect(host.querySelector(`output`)).toBe(output)
		expect(host.textContent).toBe(`new slot0 updatedNamed`)
		expect(setup).toHaveBeenCalledTimes(2)
		host.dispatchEvent(new Event(`astro:unmount`))
		expect(cleanup).toHaveBeenCalledTimes(2)
		expect(host.childNodes.length).toBe(0)
		expect(stores.length).toBe(2)
		expect(
			[...stores[1].store.atoms.keys()].some((key) =>
				key.startsWith(`🔍 spa islands`),
			),
		).toBe(false)
		host.innerHTML = `<p>fallback</p>`
		await astroClient(host)(App, props, slots, { client: `only` })
		expect(host.textContent).toBe(`from Astro0Named`)
		host.dispatchEvent(new Event(`astro:unmount`))
	})
})
