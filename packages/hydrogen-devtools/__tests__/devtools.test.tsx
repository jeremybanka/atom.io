import { scopeFamily, Silo } from "atom.io"
import type { HydrogenRoot } from "hydrogen"
import { render } from "hydrogen"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { AtomIODevtools } from "../src/index.ts"

const roots: HydrogenRoot[] = []
beforeEach(() => {
	localStorage.clear()
})
afterEach(() => {
	for (const root of roots.splice(0)) root.dispose()
	document.body.replaceChildren()
})
const tick = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve()
}
function fixture() {
	const silo = new Silo({
		name: `hydrogen-debugger`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const host = document.createElement(`section`)
	document.body.append(host)
	const mount = (hidden = false) => {
		const root = render(
			() => <AtomIODevtools store={silo.store} hideByDefault={hidden} />,
			host,
		)
		roots.push(root)
		return root
	}
	const click = async (selector: string) => {
		const element = host.querySelector<HTMLElement>(selector)
		expect(element, selector).not.toBeNull()
		element!.click()
		await tick()
	}
	const input = async (selector: string, value: string, event = `input`) => {
		const element = host.querySelector<HTMLInputElement>(selector)
		expect(element, selector).not.toBeNull()
		element!.value = value
		element!.dispatchEvent(new Event(event, { bubbles: true }))
		await tick()
	}
	return { silo, host, mount, click, input }
}
describe(`hydrogen debugger`, () => {
	it(`edits nested JSON in the supplied store and keeps selectors readonly and live`, async () => {
		const { silo, host, mount, click, input } = fixture()
		const pointAtom = silo.atom<{ x: number; y: number }>({
			key: `point`,
			default: { x: 1, y: 2 },
		})
		const sumSelector = silo.selector<number>({
			key: `sum`,
			get: ({ get }) => get(pointAtom).x + get(pointAtom).y,
		})
		const root = mount()
		await click(`button[aria-label="Expand point"]`)
		await input(`input[aria-label="x"]`, `8`)
		expect(silo.getState(pointAtom)).toEqual({ x: 8, y: 2 })
		await click(`[data-testid="view-selectors"]`)
		expect(
			host.querySelector<HTMLInputElement>(`input[aria-label="sum"]`)!.readOnly,
		).toBe(true)
		expect(
			host.querySelector<HTMLInputElement>(`input[aria-label="sum"]`)!.value,
		).toBe(`10`)
		silo.setState(pointAtom, { x: 4, y: 9 })
		await tick()
		expect(
			host.querySelector<HTMLInputElement>(`input[aria-label="sum"]`)!.value,
		).toBe(`13`)
		expect(silo.getState(sumSelector)).toBe(13)
		root.dispose()
		expect(
			[...silo.store.atoms.keys()].some((key) =>
				key.startsWith(`🔍 hydrogen devtools`),
			),
		).toBe(false)
		expect(host.querySelector(`hydrogen-devtools`)).toBeNull()
	})
	it(`renames, deletes, adds, sorts and recasts JSON without losing later updates`, async () => {
		const { silo, host, mount, click, input } = fixture()
		const recordAtom = silo.atom<Record<string, unknown>>({
			key: `record`,
			default: { name: `before`, items: [3, 1] },
		})
		mount()
		await click(`button[aria-label="Expand record"]`)
		await input(`input[aria-label="Rename name"]`, `label`, `change`)
		await input(`input[aria-label="label"]`, `after`)
		expect(silo.getState(recordAtom)).toEqual({ label: `after`, items: [3, 1] })
		await click(`button[aria-label="Expand items"]`)
		const sort = [...host.querySelectorAll(`button`)].find(
			(button) => button.textContent === `sort`,
		)!
		sort.click()
		await tick()
		expect(silo.getState(recordAtom)[`items`]).toEqual([1, 3])
		await click(`button[aria-label="Delete 0"]`)
		expect(silo.getState(recordAtom)[`items`]).toEqual([3])
		await input(`select[aria-label="Type of label"]`, `number`, `change`)
		expect(silo.getState(recordAtom)).toEqual({ label: 0, items: [3] })
		const add = [...host.querySelectorAll(`button`)].find(
			(button) => button.textContent === `add property`,
		)!
		add.click()
		await tick()
		expect(silo.getState(recordAtom)).toEqual({
			label: 0,
			items: [3],
			new: null,
		})
	})
	it(`tracks family membership and disposes members`, async () => {
		const { silo, host, mount, click } = fixture()
		const itemAtoms = silo.atomFamily<number, string>({
			key: `item`,
			default: 0,
		})
		const first = silo.findState(itemAtoms, `first`)
		silo.getState(first)
		mount()
		await click(`[data-testid="open-close-state-family-item"]`)
		expect(host.querySelectorAll(`.state-leaf input`).length).toBe(1)
		silo.getState(silo.findState(itemAtoms, `second`))
		await tick()
		expect(host.querySelectorAll(`.state-leaf input`).length).toBe(2)
		const dispose = [...host.querySelectorAll(`button`)].find(
			(button) => button.getAttribute(`aria-label`) === `Dispose ${first.key}`,
		)!
		dispose.click()
		await tick()
		expect(host.querySelectorAll(`.state-leaf input`).length).toBe(1)
	})
	it(`shows transaction outcomes and controls timeline undo and redo`, async () => {
		const { silo, host, mount, click } = fixture()
		const countAtom = silo.atom<number>({ key: `count`, default: 0 })
		const incrementTransaction = silo.transaction<(amount: number) => number>({
			key: `increment`,
			do: ({ get, set }, amount) => {
				set(countAtom, get(countAtom) + amount)
				return get(countAtom)
			},
		})
		const historyTimeline = silo.timeline({ key: `history`, scope: [countAtom] })
		mount()
		await click(`[data-testid="view-transactions"]`)
		silo.runTransaction(incrementTransaction)(2)
		await tick()
		await click(`[data-testid="open-close-transaction-increment"]`)
		expect(host.textContent).toContain(`params: [2]`)
		expect(host.textContent).toContain(`output: 2`)
		await click(`[data-testid="view-timelines"]`)
		await click(`[data-testid="open-close-timeline-history"]`)
		expect(host.textContent).toContain(`you are here`)
		const undo = [...host.querySelectorAll(`button`)].find(
			(button) => button.textContent === `undo`,
		)!
		undo.click()
		await tick()
		expect(silo.getState(countAtom)).toBe(0)
		const redo = [...host.querySelectorAll(`button`)].find(
			(button) => button.textContent === `redo`,
		)!
		redo.click()
		await tick()
		expect(silo.getState(countAtom)).toBe(2)
		silo.disposeTimeline(historyTimeline)
		await tick()
		expect(host.querySelector(`[data-testid="timeline-history"]`)).toBeNull()
	})
	it(`groups timeline families and removes disposed members`, async () => {
		const { silo, host, mount, click } = fixture()
		const countAtoms = silo.atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const historyTimelines = silo.timelineFamily<string>({
			key: `history`,
			scope: [scopeFamily(countAtoms, { timelineKey: (key) => key })],
		})
		const member = silo.findTimeline(historyTimelines, `first`)
		mount()
		await click(`[data-testid="view-timelines"]`)
		expect(
			host.querySelector(`[data-testid="timeline-family-history"]`),
		).not.toBeNull()
		silo.disposeTimeline(member)
		await tick()
		expect(
			host.querySelector(`[data-testid="timeline-family-history"]`),
		).toBeNull()
	})
	it(`persists visibility and minimization, removes the keyboard listener on unmount`, async () => {
		const { host, mount, click } = fixture()
		const root = mount(true)
		const panel = host.querySelector<HTMLElement>(`main`)!
		expect(panel.hidden).toBe(true)
		document.dispatchEvent(
			new KeyboardEvent(`keydown`, {
				ctrlKey: true,
				shiftKey: true,
				code: `KeyA`,
			}),
		)
		await tick()
		expect(panel.hidden).toBe(false)
		await click(`[data-testid="open-close-devtools"]`)
		expect(host.querySelector(`.index`)).toBeNull()
		root.dispose()
		mount(true)
		expect(host.querySelector<HTMLElement>(`main`)!.hidden).toBe(false)
		expect(host.querySelector(`.index`)).toBeNull()
		document.dispatchEvent(
			new KeyboardEvent(`keydown`, {
				ctrlKey: true,
				shiftKey: true,
				code: `KeyA`,
			}),
		)
		await tick()
		expect(host.querySelector<HTMLElement>(`main`)!.hidden).toBe(true)
	})
	it(`safely displays cyclic values and expands siblings with shift-click`, async () => {
		const { silo, host, mount, click } = fixture()
		const cycle: Record<string, unknown> = {}
		cycle[`self`] = cycle
		silo.atom<Record<string, unknown>>({ key: `cyclic`, default: cycle })
		silo.atom<{ a: { value: number }; b: { value: number } }>({
			key: `nested`,
			default: { a: { value: 1 }, b: { value: 2 } },
		})
		mount()
		expect(host.textContent).toContain(`[Circular]`)
		await click(`button[aria-label="Expand nested"]`)
		host
			.querySelector(`button[aria-label="Expand a"]`)!
			.dispatchEvent(new MouseEvent(`click`, { shiftKey: true, bubbles: true }))
		await tick()
		expect(host.querySelectorAll(`input[aria-label="value"]`).length).toBe(2)
	})
})
it(`moves the panel with pointer capture and keyboard, then resets on resize`, async () => {
	const { host, mount, click } = fixture()
	localStorage.setItem(`🔍 Devtools View`, `"invalid"`)
	const root = mount()
	const handle = host.querySelector<HTMLElement>(`[aria-label="Move debugger"]`)!
	const panel = host.querySelector<HTMLElement>(`main`)!
	handle.setPointerCapture = () => {}
	const pointer = (type: string, options: PointerEventInit = {}) =>
		handle.dispatchEvent(
			new PointerEvent(type, { bubbles: true, pointerId: 1, ...options }),
		)
	pointer(`pointermove`)
	pointer(`pointerdown`, { button: 2 })
	pointer(`pointerdown`, { button: 0, clientX: 10, clientY: 10 })
	pointer(`pointermove`, { pointerId: 2, clientX: 20 })
	pointer(`pointermove`, { clientX: 30, clientY: 40 })
	await tick()
	expect(panel.style.transform).toBe(`translate(20px,30px)`)
	pointer(`pointerup`)
	pointer(`pointermove`, { clientX: 100 })
	pointer(`pointerdown`, { button: 0 })
	pointer(`pointercancel`)
	for (const key of [`ArrowLeft`, `ArrowUp`, `ArrowRight`, `ArrowDown`, `Enter`])
		handle.dispatchEvent(new KeyboardEvent(`keydown`, { key, bubbles: true }))
	await tick()
	expect(panel.style.transform).toBe(`translate(20px,30px)`)
	window.dispatchEvent(new Event(`resize`))
	await tick()
	expect(panel.style.transform).toBe(`translate(0px,0px)`)
	await click(`[aria-label="Hide debugger (Ctrl+Shift+A)"]`)
	expect(panel.hidden).toBe(true)
	root.dispose()
})
it(`renders without explicit options and handles empty indexes`, async () => {
	const host = document.createElement(`div`)
	roots.push(render(() => <AtomIODevtools />, host))
	expect(host.querySelector(`main`)).not.toBeNull()
	const fixtureValue = fixture()
	fixtureValue.mount()
	await fixtureValue.click(`[data-testid="view-transactions"]`)
	expect(fixtureValue.host.textContent).toContain(`(no transactions)`)
	await fixtureValue.click(`[data-testid="view-timelines"]`)
	expect(fixtureValue.host.textContent).toContain(`(no timelines)`)
})
it(`rejects rename collisions, edits booleans and array members, and restores invalid numbers`, async () => {
	const { silo, host, mount, click, input } = fixture()
	const recordAtom = silo.atom<any>({
		key: `record`,
		default: { a: 1, b: 2, new: null, flag: false, list: [`z`, `a`, 3] },
	})
	mount()
	await click(`[aria-label="Expand record"]`)
	await input(`[aria-label="Rename a"]`, `b`, `change`)
	expect(host.querySelector(`[role="alert"]`)!.textContent).toContain(
		`already exists`,
	)
	await input(`[aria-label="Rename a"]`, `a`, `change`)
	expect(host.querySelector(`[role="alert"]`)).toBeNull()
	await input(`[aria-label="a"]`, `not a number`)
	expect(silo.getState(recordAtom).a).toBe(1)
	await input(`[aria-label="a"]`, ``)
	host.querySelector(`[aria-label="a"]`)!.dispatchEvent(new Event(`blur`))
	expect(
		(host.querySelector(`[aria-label="a"]`) as HTMLInputElement).value,
	).toBe(`1`)
	const flag = host.querySelector<HTMLInputElement>(`[aria-label="flag"]`)!
	flag.checked = true
	flag.dispatchEvent(new Event(`change`))
	await tick()
	expect(silo.getState(recordAtom).flag).toBe(true)
	const textButton = async (text: string) => {
		;[...host.querySelectorAll(`button`)]
			.find((button) => button.textContent === text)!
			.click()
		await tick()
	}
	await textButton(`add property`)
	expect(silo.getState(recordAtom).new_).toBe(null)
	await click(`[aria-label="Delete new_"]`)
	expect(silo.getState(recordAtom)).not.toHaveProperty(`new_`)
	await click(`[aria-label="Expand list"]`)
	await input(`[aria-label="0"]`, `b`)
	expect(silo.getState(recordAtom).list).toEqual([`b`, `a`, 3])
	await textButton(`sort`)
	expect(silo.getState(recordAtom).list).toEqual([`a`, `b`, 3])
	await textButton(`add item`)
	expect(silo.getState(recordAtom).list).toEqual([`a`, `b`, 3, null])
})
it(`expands readonly containers and circular children without exposing editing controls`, async () => {
	const { silo, host, mount, click } = fixture()
	const cycle: any = {}
	cycle.self = cycle
	silo.selector<any>({
		key: `readonly`,
		get: () => ({ flag: true, nested: { value: `x` } }),
	})
	silo.atom<any>({ key: `cycle`, default: cycle })
	mount()
	await click(`[aria-label="Expand cycle"]`)
	expect(host.querySelectorAll(`code`).length).toBeGreaterThan(1)
	await click(`[data-testid="view-selectors"]`)
	await click(`[aria-label="Expand readonly"]`)
	expect(
		host.querySelector<HTMLInputElement>(`[aria-label="flag"]`)!.disabled,
	).toBe(true)
	expect(host.querySelector(`[aria-label="Rename flag"]`)).toBeNull()
})
it(`displays thrown reads and collapsible transaction events while filtering internal timelines`, async () => {
	const { silo, host, mount, click } = fixture()
	silo.selector<number>({
		key: `throws`,
		get: () => {
			throw new Error(`read failed`)
		},
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	silo.timeline({ key: `👁‍🗨 internal`, scope: [countAtom] })
	silo.timeline({ key: `first`, scope: [countAtom] })
	silo.timeline({ key: `second`, scope: [countAtom] })
	const changeTransaction = silo.transaction<() => void>({
		key: `change`,
		do: ({ set }) => {
			set(countAtom, 1)
		},
	})
	mount()
	await click(`[data-testid="view-selectors"]`)
	expect(host.textContent).toContain(`read failed`)
	await click(`[data-testid="view-transactions"]`)
	silo.runTransaction(changeTransaction)()
	await tick()
	await click(`[data-testid="open-close-transaction-change"]`)
	await click(`.event button`)
	expect(host.textContent).not.toContain(`params:`)
	await click(`[data-testid="view-timelines"]`)
	expect(host.querySelector(`[data-testid="timeline-👁‍🗨 internal"]`)).toBeNull()
})
