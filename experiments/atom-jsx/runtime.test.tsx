import { Silo } from "atom.io"
import { IMPLICIT, setIntoStore } from "atom.io/internal"
import { afterEach, describe, expect, it, vi } from "vitest"

import { mountCounter } from "./counter.exhibit.tsx"
import { Point, pointAtom } from "./point.exhibit.tsx"
import type { Child, RenderRoot } from "./runtime.ts"
import {
	Fragment,
	jsx,
	onCleanup,
	project,
	render,
	useStore,
} from "./runtime.ts"

const roots: RenderRoot[] = []
afterEach(() => {
	for (const root of roots.splice(0)) root.dispose()
})

function fixture() {
	const silo = new Silo({
		name: `jsx-test`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const host = document.createElement(`div`)
	const mount = (child: Parameters<typeof render>[0]) => {
		const root = render(child, host, { store: silo.store })
		roots.push(root)
		return root
	}
	return { silo, countAtom, host, mount }
}

describe(`atom-native JSX`, () => {
	it(`projects a point into independent DOM bindings while keeping atomic state`, () => {
		const host = document.createElement(`div`)
		const root = render(<Point />, host)
		roots.push(root)
		const circle = host.querySelector(`circle`)!
		const setAttribute = vi.spyOn(circle, `setAttribute`)
		const text = host.querySelector(`output`)!.firstChild
		host.querySelector(`button`)!.click()
		root.flush()
		expect(circle.getAttribute(`cx`)).toBe(`21`)
		expect(circle.getAttribute(`cy`)).toBe(`31`)
		expect(host.querySelector(`output`)!.textContent).toBe(`(21, 31)`)
		expect(host.querySelector(`output`)!.firstChild).toBe(text)
		setAttribute.mockClear()
		setIntoStore(IMPLICIT.STORE, pointAtom, (point) => ({ ...point, x: 22 }))
		root.flush()
		expect(setAttribute.mock.calls).toEqual([[`cx`, `22`]])
		expect(host.querySelector(`circle`)).toBe(circle)
		root.dispose()
		expect(
			IMPLICIT.STORE.atoms.get(pointAtom.key)!.subject.subscribers.size,
		).toBe(0)
	})

	it(`subscribes only when tokens reach the DOM and leaves explicit reads as snapshots`, () => {
		const { silo, countAtom, host, mount } = fixture()
		const labelAtom = silo.atom<string>({ key: `label`, default: `before` })
		function Display(props: { value: typeof countAtom }) {
			expect(props.value).toBe(countAtom)
			expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(
				0,
			)
			return (
				<output className={labelAtom}>
					{props.value}/{silo.getState(props.value)}
				</output>
			)
		}
		const root = mount(<Display value={countAtom} />)
		silo.setState(countAtom, 5)
		silo.setState(labelAtom, `after`)
		root.flush()
		expect(host.textContent).toBe(`5/0`)
		expect(host.querySelector(`output`)!.className).toBe(`after`)
	})

	it(`accepts serialized token references and rejects non-readable resource tokens`, () => {
		const { silo, countAtom, host, mount } = fixture()
		const root = mount(structuredClone(countAtom))
		silo.setState(countAtom, 3)
		root.flush()
		expect(host.textContent).toBe(`3`)
		root.dispose()
		expect(() =>
			mount({ key: `count`, type: `transaction` } as unknown as Child),
		).toThrow(`Unsupported JSX child`)
		expect(() =>
			mount({ key: `count`, type: `atom_family` } as unknown as Child),
		).toThrow(`Unsupported JSX child`)
	})
	it(`accepts components returning tokens or scalar children and named fragments`, () => {
		const { countAtom, host, mount } = fixture()
		function Value() {
			return countAtom
		}
		function Label() {
			return `Count: `
		}
		mount(
			<Fragment>
				<Label />
				<Value />
			</Fragment>,
		)
		expect(host.textContent).toBe(`Count: 0`)
	})
	it(`updates text and props without rerunning components or replacing nodes`, () => {
		const { silo, countAtom, host, mount } = fixture()
		const setup = vi.fn()
		function Counter() {
			setup()
			const store = useStore()
			return (
				<button
					disabled={project(countAtom, (n) => n >= 2)}
					onClick={() => {
						setIntoStore(store, countAtom, (n) => n + 1)
					}}
				>
					{countAtom}
				</button>
			)
		}
		const root = mount(<Counter />)
		const button = host.querySelector(`button`)!
		const text = button.firstChild
		button.click()
		button.click()
		expect(silo.getState(countAtom)).toBe(2)
		expect(button.textContent).toBe(`0`)
		root.flush()
		expect(button.textContent).toBe(`2`)
		expect(button.disabled).toBe(true)
		expect(button.firstChild).toBe(text)
		expect(host.firstChild).toBe(button)
		expect(setup).toHaveBeenCalledTimes(1)
	})

	it(`coalesces writes in a microtask and binds derived selectors`, async () => {
		const { silo, countAtom, host, mount } = fixture()
		const doubledSelector = silo.selector<number>({
			key: `doubled`,
			get: ({ get }) => get(countAtom) * 2,
		})
		const projectValue = vi.fn((n: number) => n)
		mount(<output>{project(doubledSelector, projectValue)}</output>)
		silo.setState(countAtom, 1)
		silo.setState(countAtom, 2)
		silo.setState(countAtom, 3)
		await Promise.resolve()
		expect(host.textContent).toBe(`6`)
		expect(projectValue.mock.calls.map(([n]) => n)).toEqual([0, 6])
	})

	it(`uses atom.io transaction and dynamic selector dependencies`, () => {
		const { silo, countAtom, host, mount } = fixture()
		const otherAtom = silo.atom<number>({ key: `other`, default: 10 })
		const chooseAtom = silo.atom<boolean>({ key: `choose`, default: true })
		const selectedSelector = silo.selector<number>({
			key: `selected`,
			get: ({ get }) => (get(chooseAtom) ? get(countAtom) : get(otherAtom)),
		})
		const root = mount(<output>{selectedSelector}</output>)
		const switchValuesTransaction = silo.transaction({
			key: `switchValues`,
			do: ({ set }) => {
				set(chooseAtom, false)
				set(otherAtom, 20)
			},
		})
		silo.runTransaction(switchValuesTransaction)()
		root.flush()
		expect(host.textContent).toBe(`20`)
		silo.setState(countAtom, 99)
		root.flush()
		expect(host.textContent).toBe(`20`)
		silo.setState(otherAtom, 21)
		root.flush()
		expect(host.textContent).toBe(`21`)
	})

	it(`isolates stores even when tokens have the same key`, () => {
		const left = fixture()
		const right = fixture()
		const tree = <output>{left.countAtom}</output>
		const a = left.mount(tree)
		const b = right.mount(tree)
		left.silo.setState(left.countAtom, 7)
		a.flush()
		b.flush()
		expect(left.host.textContent).toBe(`7`)
		expect(right.host.textContent).toBe(`0`)
	})

	it(`disposes conditional branches and cancels their queued updates`, () => {
		const { silo, countAtom, host, mount } = fixture()
		const visibleAtom = silo.atom<boolean>({ key: `visible`, default: true })
		const cleanup = vi.fn()
		const projection = vi.fn((n: number) => n)
		function Detail() {
			onCleanup(cleanup)
			return <span>{project(countAtom, projection)}</span>
		}
		const root = mount(
			<div>
				{project(visibleAtom, (show) => (show ? <Detail /> : `hidden`))}
			</div>,
		)
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(1)
		silo.setState(visibleAtom, false)
		silo.setState(countAtom, 1)
		root.flush()
		expect(host.textContent).toBe(`hidden`)
		expect(cleanup).toHaveBeenCalledTimes(1)
		expect(projection).toHaveBeenCalledTimes(1)
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
		silo.setState(visibleAtom, true)
		root.flush()
		expect(host.textContent).toBe(`1`)
		root.dispose()
		expect(cleanup).toHaveBeenCalledTimes(2)
	})

	it(`removes subscriptions, listeners, refs and owned DOM on repeated disposal`, async () => {
		const { silo, countAtom, host, mount } = fixture()
		const existing = document.createElement(`aside`)
		host.append(existing)
		const click = vi.fn()
		const ref = vi.fn()
		const root = mount(
			<button ref={ref} onClick={click}>
				{countAtom}
			</button>,
		)
		const button = host.querySelector(`button`)!
		silo.setState(countAtom, 1)
		root.dispose()
		root.dispose()
		await Promise.resolve()
		button.click()
		expect(click).not.toHaveBeenCalled()
		expect(ref.mock.calls).toEqual([[button], [null]])
		expect([...host.childNodes]).toEqual([existing])
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
	})

	it(`supports fragments, arrays, SVG and foreignObject HTML`, () => {
		const { host, mount } = fixture()
		mount(
			<>
				<span>{[1, false, null, `two`]}</span>
				<svg viewBox="0 0 10 10">
					<circle cx="5" />
					<foreignObject>
						<div>HTML</div>
					</foreignObject>
				</svg>
			</>,
		)
		expect(host.textContent).toBe(`1twoHTML`)
		expect(host.querySelector(`circle`)!.namespaceURI).toBe(
			`http://www.w3.org/2000/svg`,
		)
		expect(host.querySelector(`foreignObject div`)!.namespaceURI).toBe(
			`http://www.w3.org/1999/xhtml`,
		)
		expect(host.querySelector(`svg`)!.getAttribute(`viewBox`)).toBe(`0 0 10 10`)
	})

	it(`updates form properties and preserves false aria values`, () => {
		const { silo, countAtom, host, mount } = fixture()
		const root = mount(
			<>
				<label htmlFor="field" className="label" />
				<input
					id="field"
					value={project(countAtom, String)}
					checked={project(countAtom, Boolean)}
					aria-disabled={project(countAtom, Boolean)}
				/>
			</>,
		)
		const input = host.querySelector(`input`)!
		expect(input.getAttribute(`aria-disabled`)).toBe(`false`)
		expect(input.checked).toBe(false)
		silo.setState(countAtom, 4)
		root.flush()
		expect(input.value).toBe(`4`)
		expect(input.checked).toBe(true)
		expect(input.getAttribute(`aria-disabled`)).toBe(`true`)
		expect(host.querySelector(`label`)!.htmlFor).toBe(`field`)
	})

	it(`uses native event bubbling, capture and double click`, () => {
		const { host, mount } = fixture()
		const calls: string[] = []
		mount(
			<div
				onClickCapture={() => calls.push(`capture`)}
				onClick={() => calls.push(`bubble`)}
			>
				<button
					onClick={() => calls.push(`target`)}
					onDoubleClick={() => calls.push(`double`)}
				/>
			</div>,
		)
		const button = host.querySelector(`button`)!
		button.click()
		button.dispatchEvent(new MouseEvent(`dblclick`))
		expect(calls).toEqual([`capture`, `target`, `bubble`, `double`])
	})

	it(`initializes a selected value after mounting the options`, () => {
		const { silo, host, mount } = fixture()
		const choiceAtom = silo.atom<string>({ key: `choice`, default: `b` })
		const root = mount(
			<select value={choiceAtom}>
				<option value="a">A</option>
				<option value="b">B</option>
			</select>,
		)
		const select = host.querySelector(`select`)!
		expect(select.value).toBe(`b`)
		silo.setState(choiceAtom, `a`)
		root.flush()
		expect(select.value).toBe(`a`)
	})

	it(`passes tokens through component props without rerunning the component`, () => {
		const { silo, countAtom, host, mount } = fixture()
		const setup = vi.fn()
		function Label(props: { children: Child }) {
			setup()
			return <output>{props.children}</output>
		}
		const root = mount(<Label>{countAtom}</Label>)
		silo.setState(countAtom, 8)
		root.flush()
		expect(host.textContent).toBe(`8`)
		expect(setup).toHaveBeenCalledOnce()
	})

	it(`restores the parent owner after mounting a nested root`, () => {
		const { host, mount } = fixture()
		const cleanup = vi.fn()
		function NestedRoot() {
			const nested = render(<span>nested</span>, document.createElement(`div`))
			onCleanup(nested.dispose)
			onCleanup(cleanup)
			return <span>outer</span>
		}
		const root = mount(<NestedRoot />)
		expect(host.textContent).toBe(`outer`)
		root.dispose()
		expect(cleanup).toHaveBeenCalledOnce()
	})

	it(`cleans partial mounts when a component throws`, () => {
		const { silo, countAtom, host } = fixture()
		const cleanup = vi.fn()
		function Broken(): never {
			onCleanup(cleanup)
			throw new Error(`broken`)
		}
		expect(() =>
			render(
				<>
					{countAtom}
					<Broken />
				</>,
				host,
				{ store: silo.store },
			),
		).toThrow(`broken`)
		expect(cleanup).toHaveBeenCalledOnce()
		expect(host.childNodes.length).toBe(0)
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
		expect(() => useStore()).toThrow(`mounted component`)
	})

	it(`cleans the root after a failing update`, () => {
		const { silo, countAtom, host, mount } = fixture()
		const root = mount(
			<output>
				{project(countAtom, (n) => {
					if (n === 1) throw new Error(`projection failed`)
					return n
				})}
			</output>,
		)
		silo.setState(countAtom, 1)
		expect(() => {
			root.flush()
		}).toThrow(`projection failed`)
		expect(host.childNodes.length).toBe(0)
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
	})

	it(`finishes disposal even if a user cleanup throws`, () => {
		const { silo, countAtom, host, mount } = fixture()
		function BrokenCleanup() {
			onCleanup(() => {
				throw new Error(`cleanup failed`)
			})
			return <output>{countAtom}</output>
		}
		const root = mount(<BrokenCleanup />)
		expect(() => {
			root.dispose()
		}).toThrow(AggregateError)
		expect(host.childNodes.length).toBe(0)
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
	})

	it(`rejects unsupported keys and raw HTML instead of silently accepting them`, () => {
		const { host, mount } = fixture()
		expect(() => jsx(`div`, {}, `row`)).toThrow(`Keyed reconciliation`)
		expect(() => mount(<div innerHTML="unowned" />)).toThrow(`owned children`)
		expect(host.childNodes.length).toBe(0)
	})

	it(`runs the counter exhibit with the default store`, () => {
		const host = document.createElement(`div`)
		const root = mountCounter(host)
		roots.push(root)
		host.querySelector(`button`)!.click()
		root.flush()
		expect(host.querySelector(`output`)!.textContent).toBe(`1`)
		expect(host.textContent).toContain(`Doubled: 2`)
	})
})
