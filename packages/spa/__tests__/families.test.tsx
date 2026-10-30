import { scopeFamily, Silo } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { Accessor, SpaRoot, TimelineValue } from "../src/index.ts"
import {
	onCleanup,
	render,
	useRef,
	useSetter,
	useTimeline,
	useValue,
} from "../src/index.ts"
import { renderToString } from "../src/server.ts"

const roots: SpaRoot[] = []
afterEach(() => {
	for (const root of roots.splice(0)) root.dispose()
	document.body.replaceChildren()
})
function fixture(initial = 0) {
	const silo = new Silo({
		name: `families`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtoms = silo.atomFamily<number, Canonical>({
		key: `count`,
		default: initial,
	})
	const elementAtoms = silo.atomFamily<HTMLButtonElement | null, Canonical>({
		key: `element`,
		default: null,
	})
	const historyTimelines = silo.timelineFamily<Canonical>({
		key: `history`,
		scope: [scopeFamily(countAtoms, { timelineKey: (key) => key })],
	})
	const host = document.createElement(`section`)
	document.body.append(host)
	const mount = (setup: Parameters<typeof render>[0]) => {
		const root = render(setup, host, { store: silo.store })
		roots.push(root)
		return root
	}
	return { silo, countAtoms, elementAtoms, historyTimelines, host, mount }
}

describe(`streamlined families`, () => {
	it.each([0, ``, false, null, [1, `a`]] as Canonical[])(
		`accepts the canonical key %j for reads, writes, refs, and timelines`,
		(key) => {
			const { silo, countAtoms, elementAtoms, historyTimelines, host, mount } =
				fixture()
			let history!: Accessor<TimelineValue>
			const setup = vi.fn()
			const root = mount(() => {
				setup()
				const value = useValue(countAtoms, key)
				const setValue = useSetter(countAtoms, key)
				const ref = useRef(elementAtoms, key)
				history = useTimeline(historyTimelines, key)
				return (
					<button
						ref={ref}
						onClick={() => {
							setValue((previous) => previous + 1)
						}}
					>
						{value()}:{history().at}/{history().length}
					</button>
				)
			})
			history().clear()
			root.flush()
			const button = host.querySelector(`button`)!
			expect(silo.getState(elementAtoms, key)).toBe(button)
			button.click()
			root.flush()
			expect(host.textContent).toBe(`1:1/1`)
			history().undo()
			root.flush()
			expect(host.textContent).toBe(`0:0/1`)
			history().redo()
			root.flush()
			expect(host.textContent).toBe(`1:1/1`)
			expect(setup).toHaveBeenCalledOnce()
			root.dispose()
			expect(silo.getState(elementAtoms, key)).toBe(null)
			const timeline = silo.findTimeline(historyTimelines, key)
			expect(
				silo.store.timelines.get(timeline.key)!.subject.subscribers.size,
			).toBe(0)
		},
	)

	it(`reads and writes selector-family members`, () => {
		const { silo, countAtoms, host, mount } = fixture()
		const doubledSelectors = silo.selectorFamily<number, number>({
			key: `doubled`,
			get:
				(key) =>
				({ get }) =>
					get(countAtoms, key) * 2,
			set:
				(key) =>
				({ set }, value) => {
					set(countAtoms, key, value / 2)
				},
		})
		const root = mount(() => {
			const value = useValue(doubledSelectors, 1)
			const setValue = useSetter(doubledSelectors, 1)
			return (
				<button
					onClick={() => {
						setValue((previous) => previous + 4)
					}}
				>
					{value()}
				</button>
			)
		})
		host.querySelector(`button`)!.click()
		root.flush()
		expect(host.textContent).toBe(`4`)
		expect(silo.getState(countAtoms, 1)).toBe(2)
		expect(silo.getState(countAtoms, 2)).toBe(0)
	})

	it(`resolves the same family tokens independently in each root store`, () => {
		const first = fixture(1)
		const second = fixture(10)
		const App = () => {
			const value = useValue(first.countAtoms, 0)
			const setValue = useSetter(first.countAtoms, 0)
			const ref = useRef(first.elementAtoms, 0)
			const history = useTimeline(first.historyTimelines, 0)
			return (
				<button
					ref={ref}
					onClick={() => {
						setValue((previous) => previous + 1)
					}}
				>
					{value()}:{history().at}
				</button>
			)
		}
		const a = first.mount(() => <App />)
		const b = second.mount(() => <App />)
		first.silo.clearTimeline(first.historyTimelines, 0)
		second.silo.clearTimeline(first.historyTimelines, 0)
		a.flush()
		b.flush()
		const buttonA = first.host.querySelector(`button`)!
		const buttonB = second.host.querySelector(`button`)!
		buttonB.click()
		b.flush()
		expect(first.silo.getState(first.countAtoms, 0)).toBe(1)
		expect(second.silo.getState(first.countAtoms, 0)).toBe(11)
		expect(first.silo.getState(first.elementAtoms, 0)).toBe(buttonA)
		expect(second.silo.getState(first.elementAtoms, 0)).toBe(buttonB)
		expect(first.host.textContent).toBe(`1:0`)
		expect(second.host.textContent).toBe(`11:1`)
		a.dispose()
		expect(first.silo.getState(first.elementAtoms, 0)).toBe(null)
		expect(second.silo.getState(first.elementAtoms, 0)).toBe(buttonB)
	})

	it(`captures keys once and releases refs and subscriptions when a keyed instance changes`, () => {
		const { silo, countAtoms, elementAtoms, historyTimelines, host, mount } =
			fixture()
		const selectedAtom = silo.atom<number>({ key: `selected`, default: 1 })
		const disposed = vi.fn()
		function Row(props: { id: number }) {
			const id = props.id
			const value = useValue(countAtoms, id)
			const setValue = useSetter(countAtoms, id)
			const ref = useRef(elementAtoms, id)
			const history = useTimeline(historyTimelines, id)
			onCleanup(() => {
				disposed(id)
			})
			return (
				<button
					ref={ref}
					onClick={() => {
						setValue(5)
					}}
				>
					{value()}:{history().at}
				</button>
			)
		}
		const root = mount(() => {
			const selected = useValue(selectedAtom)
			return <>{[<Row key={selected()} id={selected()} />]}</>
		})
		const firstButton = host.querySelector(`button`)!
		firstButton.click()
		root.flush()
		silo.setState(selectedAtom, 2)
		root.flush()
		expect(disposed).toHaveBeenCalledWith(1)
		expect(silo.getState(elementAtoms, 1)).toBe(null)
		expect(silo.getState(elementAtoms, 2)).toBe(host.querySelector(`button`))
		expect(host.textContent).toBe(`0:1`)
		firstButton.click()
		expect(silo.getState(countAtoms, 1)).toBe(5)
		const oldTimeline = silo.findTimeline(historyTimelines, 1)
		expect(
			silo.store.timelines.get(oldTimeline.key)!.subject.subscribers.size,
		).toBe(0)
		host.querySelector(`button`)!.click()
		root.flush()
		expect(silo.getState(countAtoms, 2)).toBe(5)
		root.dispose()
		expect(silo.getState(elementAtoms, 2)).toBe(null)
	})

	it(`keeps a newer ref owner when an older family binding is disposed`, () => {
		const { silo, elementAtoms, host, mount } = fixture()
		const Button = () => {
			const ref = useRef(elementAtoms, 1)
			return <button ref={ref} />
		}
		const first = mount(() => <Button />)
		const second = mount(() => <Button />)
		const latest = host.querySelectorAll(`button`)[1]
		first.dispose()
		expect(silo.getState(elementAtoms, 1)).toBe(latest)
		second.dispose()
		expect(silo.getState(elementAtoms, 1)).toBe(null)
	})

	it(`renders family values and timelines on the server without attaching refs or subscriptions`, () => {
		const { silo, countAtoms, elementAtoms, historyTimelines, host } = fixture(7)
		const html = renderToString(
			() => {
				const value = useValue(countAtoms, 1)
				const history = useTimeline(historyTimelines, 1)
				const ref = useRef(elementAtoms, 1)
				return (
					<button ref={ref}>
						{value()}:{history().at}
					</button>
				)
			},
			{ store: silo.store },
		)
		host.innerHTML = html
		expect(host.textContent).toBe(`7:1`)
		expect(silo.getState(elementAtoms, 1)).toBe(null)
		const timeline = silo.findTimeline(historyTimelines, 1)
		expect(
			silo.store.timelines.get(timeline.key)!.subject.subscribers.size,
		).toBe(0)
	})
})
