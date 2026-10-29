import type { WaterRoot } from "@atom.io/water"
import { render } from "@atom.io/water"
import { scopeFamily, Silo } from "atom.io"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { AtomIODevtools } from "../src/index.ts"

const roots: WaterRoot[] = []
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
		name: `water-debugger`,
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
describe(`water debugger`, () => {
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
				key.startsWith(`🔍 water devtools`),
			),
		).toBe(false)
		expect(host.querySelector(`water-devtools`)).toBeNull()
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
