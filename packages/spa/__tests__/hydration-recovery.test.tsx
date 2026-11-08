import { Silo } from "atom.io"
import { afterEach, expect, it, vi } from "vitest"

import type { SpaRoot } from "../src/index.ts"
import {
	hydrate,
	onCleanup,
	onMount,
	render,
	useGetter,
	useId,
	useSetter,
} from "../src/index.ts"
import { renderToString } from "../src/server.ts"

const roots: SpaRoot[] = []
afterEach(() => {
	for (const root of roots.splice(0)) root.dispose()
	document.body.replaceChildren()
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

it.each([true, false])(
	`repairs text, element, namespace, marker, missing and excess DOM while keeping the root live (development=%s)`,
	(dev) => {
		vi.stubEnv(`DEV`, dev)
		const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
		for (const damage of [
			`text`,
			`element`,
			`missing`,
			`children`,
			`root`,
			`namespace`,
			`marker`,
			`empty`,
		]) {
			const silo = new Silo({
				name: `recovery`,
				lifespan: `ephemeral`,
				isProduction: true,
			})
			const countAtom = silo.atom<number>({ key: `count`, default: 0 })
			const setup = vi.fn(),
				mounted = vi.fn(),
				cleanup = vi.fn()
			function App() {
				setup()
				onMount(mounted)
				onCleanup(cleanup)
				const count = useGetter(countAtom),
					setCount = useSetter(countAtom)
				return (
					<article>
						<input defaultValue="initial" />
						<button
							onClick={() => {
								setCount((n) => n + 1)
							}}
						>
							{count()}
						</button>
						<svg>
							<circle r="2" />
						</svg>
					</article>
				)
			}
			const host = document.createElement(`section`)
			host.innerHTML = renderToString(() => <App />, {
				store: silo.store,
				idPrefix: `recover`,
			})
			document.body.append(host)
			setup.mockClear()
			cleanup.mockClear()
			warning.mockClear()
			const input = host.querySelector(`input`)!
			input.value = `unsaved`
			input.focus()
			const button = host.querySelector(`button`)!
			if (damage === `text`)
				Array.from(button.childNodes).find(
					(node) => node.nodeType === 3,
				)!.nodeValue = `wrong`
			if (damage === `element`)
				button.replaceWith(document.createElement(`span`))
			if (damage === `missing`) button.remove()
			if (damage === `children`)
				host.querySelector(`article`)!.append(document.createElement(`aside`))
			if (damage === `root`) host.append(document.createTextNode(`extra`))
			if (damage === `namespace`)
				host
					.querySelector(`circle`)!
					.replaceWith(document.createElement(`circle`))
			if (damage === `marker`) host.firstChild!.nodeValue = `wrong root marker`
			if (damage === `empty`) host.replaceChildren()
			const root = hydrate(() => <App />, host, { store: silo.store })
			roots.push(root)
			expect(setup).toHaveBeenCalledOnce()
			expect(mounted).toHaveBeenCalledOnce()
			expect(cleanup).not.toHaveBeenCalled()
			expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(
				1,
			)
			expect(warning).toHaveBeenCalledExactlyOnceWith(
				expect.stringMatching(/hydration mismatch.*Repairing.*unsaved input/),
				expect.objectContaining({ host }),
			)
			expect(host.querySelector(`aside`)).toBeNull()
			expect(host.querySelector(`circle`)!.namespaceURI).toBe(
				`http://www.w3.org/2000/svg`,
			)
			if (damage !== `empty`) {
				expect(host.querySelector(`input`)).toBe(input)
				expect(input.value).toBe(`unsaved`)
				expect(document.activeElement).toBe(input)
			}
			host.querySelector(`button`)!.click()
			root.flush()
			expect(silo.getState(countAtom)).toBe(1)
			expect(host.querySelector(`button`)!.textContent).toBe(`1`)
			expect(warning).toHaveBeenCalledOnce()
			root.dispose()
			expect(cleanup).toHaveBeenCalledOnce()
			expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(
				0,
			)
		}
	},
)

it(`honors an explicit client ID prefix during recovery and leaves another root interactive`, () => {
	const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
	const host = document.createElement(`section`),
		neighbor = document.createElement(`section`)
	let clicks = 0
	roots.push(
		render(
			() => (
				<button
					onClick={() => {
						clicks++
					}}
				>
					neighbor
				</button>
			),
			neighbor,
		),
	)
	const neighboringButton = neighbor.querySelector(`button`)
	function Field() {
		const id = useId()
		return (
			<>
				<label htmlFor={id}>Name</label>
				<input id={id} />
			</>
		)
	}
	host.innerHTML = renderToString(() => <Field />, { idPrefix: `server` })
	roots.push(hydrate(() => <Field />, host, { idPrefix: `client` }))
	expect(host.querySelector(`input`)!.id).toBe(`client-0`)
	expect(host.querySelector(`label`)!.htmlFor).toBe(`client-0`)
	expect(warning).toHaveBeenCalledOnce()
	expect(neighbor.querySelector(`button`)).toBe(neighboringButton)
	neighboringButton!.click()
	expect(clicks).toBe(1)
})

it(`keeps application exceptions distinct from repairable DOM mismatches`, () => {
	const warning = vi.spyOn(console, `warn`).mockImplementation(() => {})
	const host = document.createElement(`section`)
	host.innerHTML = renderToString(() => <p>server</p>)
	const cleanup = vi.fn()
	const failure = new Error(`spa: hydration mismatch`)
	expect(() =>
		hydrate(() => {
			onCleanup(cleanup)
			throw failure
		}, host),
	).toThrow(failure)
	expect(cleanup).toHaveBeenCalledOnce()
	expect(warning).not.toHaveBeenCalled()
})
