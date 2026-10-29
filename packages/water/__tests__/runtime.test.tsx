import { Silo } from "atom.io"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WaterRoot } from "../src/index.ts"
import {
	hydrate,
	onCleanup,
	onMount,
	render,
	untrack,
	useId,
	useRef,
	useSetter,
	useTimeline,
	useTransaction,
	useValue,
} from "../src/index.ts"
import { renderToString } from "../src/server.ts"

const roots: WaterRoot[] = []
afterEach(() => {
	for (const root of roots.splice(0)) root.dispose()
	document.body.replaceChildren()
})
function fixture() {
	const silo = new Silo({
		name: `water-test`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const host = document.createElement(`div`)
	document.body.append(host)
	const mount = (setup: Parameters<typeof render>[0]) => {
		const root = render(setup, host, { store: silo.store, idPrefix: `test` })
		roots.push(root)
		return root
	}
	return { silo, countAtom, host, mount }
}
describe(`water compiled DOM`, () => {
	it(`runs setup once and tracks JSX calls, including helper functions`, async () => {
		const { silo, countAtom, host, mount } = fixture()
		const setup = vi.fn()
		function Counter() {
			setup()
			const count = useValue(countAtom)
			const setCount = useSetter(countAtom)
			const label = () => `Count ${count()}`
			return (
				<button
					disabled={count() >= 2}
					onClick={() => {
						setCount((n) => n + 1)
					}}
				>
					{label()}
				</button>
			)
		}
		mount(() => <Counter />)
		const button = host.querySelector(`button`)!
		const text = [...button.childNodes].find((node) => node.nodeType === 3)!
		button.click()
		button.click()
		await Promise.resolve()
		expect(button.textContent).toBe(`Count 2`)
		expect(button.disabled).toBe(true)
		expect(text.nodeValue).toBe(`Count 2`)
		expect(setup).toHaveBeenCalledOnce()
		expect(silo.getState(countAtom)).toBe(2)
	})
	it(`keeps inline event closures attached while unrelated attributes update`, () => {
		const { silo, countAtom, host, mount } = fixture()
		const add = vi.spyOn(HTMLButtonElement.prototype, `addEventListener`)
		try {
			function Button() {
				const count = useValue(countAtom)
				const setCount = useSetter(countAtom)
				return (
					<button
						title={String(count())}
						onClick={() => {
							setCount((n) => n + 1)
						}}
					>
						Add
					</button>
				)
			}
			const root = mount(() => <Button />)
			silo.setState(countAtom, 1)
			root.flush()
			host.querySelector(`button`)!.click()
			root.flush()
			expect(silo.getState(countAtom)).toBe(2)
			expect(add.mock.calls.filter(([event]) => event === `click`)).toHaveLength(
				1,
			)
		} finally {
			add.mockRestore()
		}
	})

	it(`reconciles conditional dependencies and permits untracked reads`, () => {
		const { silo, countAtom, host, mount } = fixture()
		const toggleAtom = silo.atom<boolean>({ key: `toggle`, default: true })
		const otherAtom = silo.atom<number>({ key: `other`, default: 9 })
		function Choice() {
			const toggle = useValue(toggleAtom)
			const count = useValue(countAtom)
			const other = useValue(otherAtom)
			return (
				<output>
					{toggle() ? count() : other()}:{untrack(count)}
				</output>
			)
		}
		const root = mount(() => <Choice />)
		expect(host.textContent).toBe(`0:0`)
		silo.setState(countAtom, 1)
		root.flush()
		expect(host.textContent).toBe(`1:0`)
		silo.setState(toggleAtom, false)
		root.flush()
		expect(host.textContent).toBe(`9:0`)
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
		silo.setState(otherAtom, 10)
		root.flush()
		expect(host.textContent).toBe(`10:0`)
	})
	it(`preserves keyed component instances, focused inputs, and live props during reorder`, () => {
		const { silo, host, mount } = fixture()
		const rowsAtom = silo.atom<{ id: string; label: string }[]>({
			key: `rows`,
			default: [
				{ id: `a`, label: `A` },
				{ id: `b`, label: `B` },
			],
		})
		const setup = vi.fn()
		const cleanup = vi.fn()
		function Row(props: { item: { id: string; label: string } }) {
			setup(props.item.id)
			const id = useId()
			onCleanup(() => cleanup(id))
			return <input id={id} data-key={props.item.id} value={props.item.label} />
		}
		function List() {
			const rows = useValue(rowsAtom)
			return (
				<section>
					{rows().map((item) => (
						<Row key={item.id} item={item} />
					))}
				</section>
			)
		}
		const root = mount(() => <List />)
		const a = host.querySelector<HTMLInputElement>(`[data-key="a"]`)!
		const b = host.querySelector<HTMLInputElement>(`[data-key="b"]`)!
		a.focus()
		a.setSelectionRange(1, 1)
		silo.setState(rowsAtom, [
			{ id: `b`, label: `Bee` },
			{ id: `a`, label: `A` },
		])
		root.flush()
		expect([...host.querySelectorAll(`input`)]).toEqual([b, a])
		expect(b.value).toBe(`Bee`)
		expect(document.activeElement).toBe(a)
		expect(a.selectionStart).toBe(1)
		expect(setup).toHaveBeenCalledTimes(2)
		expect(cleanup).not.toHaveBeenCalled()
		silo.setState(rowsAtom, [{ id: `a`, label: `A` }])
		root.flush()
		expect(cleanup).toHaveBeenCalledTimes(1)
		root.dispose()
		expect(cleanup).toHaveBeenCalledTimes(2)
	})
	it(`replaces keyed component ownership when its token changes`, () => {
		const { silo, countAtom, host, mount } = fixture()
		const otherAtom = silo.atom<number>({ key: `other`, default: 20 })
		const toggleAtom = silo.atom<boolean>({ key: `toggle`, default: true })
		function Child(props: { token: typeof countAtom }) {
			const value = useValue(props.token)
			return <output>{value()}</output>
		}
		function Parent() {
			const toggle = useValue(toggleAtom)
			return (
				<>
					{toggle() ? (
						<Child key="count" token={countAtom} />
					) : (
						<Child key="other" token={otherAtom} />
					)}
				</>
			)
		}
		const root = mount(() => <Parent />)
		silo.setState(toggleAtom, false)
		root.flush()
		expect(host.textContent).toBe(`20`)
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
		silo.setState(otherAtom, 21)
		root.flush()
		expect(host.textContent).toBe(`21`)
	})
	it(`updates spread keys, styles, boolean attributes and event handlers`, () => {
		const { silo, host, mount } = fixture()
		const first = vi.fn()
		const second = vi.fn()
		const propsAtom = silo.atom<Record<string, unknown>>({
			key: `props`,
			default: {
				title: `first`,
				onClick: first,
				style: `color:red`,
				"aria-disabled": false,
			},
		})
		function Button() {
			const props = useValue(propsAtom)
			return <button {...props()}>Press</button>
		}
		const root = mount(() => <Button />)
		const button = host.querySelector(`button`)!
		button.click()
		expect(first).toHaveBeenCalledOnce()
		expect(button.getAttribute(`aria-disabled`)).toBe(`false`)
		silo.setState(propsAtom, {
			onClick: second,
			disabled: false,
			style: `background-color:blue`,
			"data-next": `yes`,
		})
		root.flush()
		button.click()
		expect(second).toHaveBeenCalledOnce()
		expect(first).toHaveBeenCalledOnce()
		expect(button.title).toBe(``)
		expect(button.style.color).toBe(``)
		expect(button.style.backgroundColor).toBe(`blue`)
		expect(button.dataset[`next`]).toBe(`yes`)
		root.dispose()
		button.click()
		expect(second).toHaveBeenCalledOnce()
	})
	it(`publishes refs after attachment, runs mount once, and guards competing owners`, () => {
		const { silo, host, mount } = fixture()
		const elementAtom = silo.atom<HTMLButtonElement | null>({
			key: `element`,
			default: null,
		})
		const mounted = vi.fn()
		function Button() {
			const ref = useRef(elementAtom)
			onMount(() => mounted(silo.getState(elementAtom)))
			return <button ref={ref} />
		}
		const a = mount(() => <Button />)
		const buttonA = host.querySelector(`button`)!
		expect(silo.getState(elementAtom)).toBe(buttonA)
		expect(mounted).toHaveBeenCalledWith(buttonA)
		const b = mount(() => <Button />)
		const buttonB = host.querySelectorAll(`button`)[1]
		a.dispose()
		expect(silo.getState(elementAtom)).toBe(buttonB)
		b.dispose()
		expect(silo.getState(elementAtom)).toBe(null)
	})
	it(`cancels removed child updates and unsubscribes on disposal`, () => {
		const { silo, countAtom, host, mount } = fixture()
		const visibleAtom = silo.atom<boolean>({ key: `visible`, default: true })
		const cleanup = vi.fn()
		const computed = vi.fn()
		function Detail() {
			const value = useValue(countAtom)
			onCleanup(cleanup)
			const read = () => {
				computed()
				return value()
			}
			return <span>{read()}</span>
		}
		function App() {
			const visible = useValue(visibleAtom)
			return <>{visible() ? <Detail /> : `hidden`}</>
		}
		const root = mount(() => <App />)
		silo.setState(visibleAtom, false)
		silo.setState(countAtom, 1)
		root.flush()
		expect(host.textContent).toBe(`hidden`)
		expect(cleanup).toHaveBeenCalledOnce()
		expect(computed).toHaveBeenCalledOnce()
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
	})
	it(`binds transactions and timelines to the supplied store`, () => {
		const { silo, countAtom, host, mount } = fixture()
		const historyTimeline = silo.timeline({ key: `history`, scope: [countAtom] })
		const incrementTransaction = silo.transaction<(amount: number) => number>({
			key: `increment`,
			do: ({ get, set }, amount) => {
				set(countAtom, get(countAtom) + amount)
				return get(countAtom)
			},
		})
		function Controls() {
			const count = useValue(countAtom)
			const history = useTimeline(historyTimeline)
			const increment = useTransaction(incrementTransaction)
			return (
				<>
					<output>
						{count()}:{history().at}/{history().length}
					</output>
					<button
						onClick={() => {
							expect(increment(2)).toBe(2)
						}}
					>
						Add
					</button>
					<button
						onClick={() => {
							history().undo()
						}}
					>
						Undo
					</button>
				</>
			)
		}
		const root = mount(() => <Controls />)
		host.querySelectorAll(`button`)[0].click()
		root.flush()
		expect(host.textContent).toContain(`2:`)
		host.querySelectorAll(`button`)[1].click()
		root.flush()
		expect(host.textContent).toContain(`0:`)
	})
	it(`removes listeners attached before a later property fails`, () => {
		const { mount } = fixture()
		const clicked = vi.fn()
		const add = vi.spyOn(HTMLButtonElement.prototype, `addEventListener`)
		try {
			expect(() =>
				mount(() => <button onClick={clicked} innerHTML="invalid" />),
			).toThrow()
			const button = add.mock.contexts[0] as HTMLButtonElement
			button.click()
			expect(clicked).not.toHaveBeenCalled()
		} finally {
			add.mockRestore()
		}
	})

	it(`cleans failed setup, invalid children, and throwing cleanup`, () => {
		const { silo, countAtom, host, mount } = fixture()
		function Broken() {
			const value = useValue(countAtom)
			onCleanup(() => {
				throw new Error(`cleanup`)
			})
			return (
				<>
					{value()}
					{Promise.resolve(1) as any}
				</>
			)
		}
		expect(() => mount(() => <Broken />)).toThrow(AggregateError)
		expect(host.childNodes.length).toBe(0)
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
		expect(() => useId()).toThrow()
	})
})

describe(`server rendering and hydration`, () => {
	it(`hydrates the same nodes, restores subscriptions and preserves server IDs`, () => {
		const { silo, countAtom, host } = fixture()
		const cleanup = vi.fn()
		function App() {
			const id = useId()
			const count = useValue(countAtom)
			const setCount = useSetter(countAtom)
			onCleanup(cleanup)
			return (
				<>
					<label htmlFor={id}>Count</label>
					<input id={id} value={count()} />
					<button
						onClick={() => {
							setCount((n) => n + 1)
						}}
					>
						{count()}
					</button>
				</>
			)
		}
		const setup = () => <App />
		host.innerHTML = renderToString(setup, {
			store: silo.store,
			idPrefix: `island`,
		})
		expect(cleanup).toHaveBeenCalledOnce()
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
		const input = host.querySelector(`input`)!
		const button = host.querySelector(`button`)!
		const root = hydrate(setup, host, { store: silo.store })
		roots.push(root)
		expect(host.querySelector(`input`)).toBe(input)
		expect(input.id).toBe(`island-0`)
		button.click()
		root.flush()
		expect(input.value).toBe(`1`)
		expect(button.textContent).toBe(`1`)
		root.dispose()
		expect(cleanup).toHaveBeenCalledTimes(2)
	})
	it(`escapes content, handles SVG and reports mismatches without leaving subscriptions`, () => {
		const { silo, countAtom, host } = fixture()
		function App() {
			const count = useValue(countAtom)
			return (
				<svg viewBox="0 0 10 10">
					<text title={`"<script>`}>
						{`<&`}
						{count()}HTML
					</text>
				</svg>
			)
		}
		const setup = () => <App />
		const html = renderToString(setup, { store: silo.store, idPrefix: `svg` })
		expect(html).toContain(`&lt;&amp;`)
		host.innerHTML = html
		const root = hydrate(setup, host, { store: silo.store })
		roots.push(root)
		expect(host.querySelector(`svg`)!.namespaceURI).toBe(
			`http://www.w3.org/2000/svg`,
		)
		root.dispose()
		host.innerHTML = html.replace(`HTML`, `mismatch`)
		expect(() => hydrate(setup, host, { store: silo.store })).toThrow(
			`hydration`,
		)
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
	})
})
