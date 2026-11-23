import type { SpaRoot } from "@atom.io/spa"
import { render } from "@atom.io/spa"
import { scopeFamily, Silo } from "atom.io"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { AtomIODevtools } from "../src/index.ts"

const roots: SpaRoot[] = []
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
		name: `spa-debugger`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const host = document.createElement(`section`)
	document.body.append(host)
	const mount = (hidden = false) => {
		if (localStorage.getItem(`🔍 Devtools View`) === null)
			localStorage.setItem(`🔍 Devtools View`, JSON.stringify(`atoms`))
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
describe(`spa debugger`, () => {
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
				key.startsWith(`🔍 spa devtools`),
			),
		).toBe(false)
		expect(host.querySelector(`devtools`)).toBeNull()
	})
	it(`keeps incomplete decimal edits in numeric fields`, async () => {
		const { silo, host, mount, input } = fixture()
		const amountAtom = silo.atom<number>({ key: `amount`, default: 1 })
		mount()
		const selector = `input[aria-label="amount"]`
		const field = host.querySelector<HTMLInputElement>(selector)!
		field.focus()
		await input(selector, `${field.value}.`)
		expect(field.value).toBe(`1.`)
		expect(silo.getState(amountAtom)).toBe(1)
		await input(selector, `${field.value}5`)
		expect(silo.getState(amountAtom)).toBe(1.5)

		await input(selector, ``)
		expect(field.value).toBe(``)
		await input(selector, `-`)
		expect(field.value).toBe(`-`)
		expect(silo.getState(amountAtom)).toBe(1.5)
		await input(selector, `${field.value}2.50`)
		expect(silo.getState(amountAtom)).toBe(-2.5)
		expect(field.value).toBe(`-2.50`)
		field.blur()
		expect(field.value).toBe(`-2.5`)

		field.focus()
		await input(selector, `-2.500`)
		silo.setState(amountAtom, 3)
		await tick()
		expect(field.value).toBe(`3`)
		silo.setState(amountAtom, -2.5)
		await tick()
		expect(field.value).toBe(`-2.5`)
	})
	it(`renames, deletes, adds, sorts and recasts JSON without losing later updates`, async () => {
		const { silo, host, mount, click, input } = fixture()
		const recordAtom = silo.atom<Record<string, unknown>>({
			key: `record`,
			default: { name: `before`, items: [3, 1] },
		})
		mount()
		await click(`button[aria-label="Expand record"]`)
		await input(`input[aria-label="Rename name"]`, `label`)
		expect(silo.getState(recordAtom)[`name`]).toBe(`before`)
		expect(
			host.querySelector<HTMLInputElement>(`input[aria-label="Rename name"]`)!
				.value,
		).toBe(`label`)
		const rename = host.querySelector<HTMLInputElement>(
			`input[aria-label="Rename name"]`,
		)!
		rename.focus()
		rename.dispatchEvent(
			new KeyboardEvent(`keydown`, { key: `ArrowLeft`, bubbles: true }),
		)
		rename.dispatchEvent(
			new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }),
		)
		await tick()
		await input(`input[aria-label="label"]`, `after`)
		expect(silo.getState(recordAtom)).toEqual({ label: `after`, items: [3, 1] })
		await click(`button[aria-label="Expand items"]`)
		await click(`button[aria-label="Sort"]`)
		expect(silo.getState(recordAtom)[`items`]).toEqual([1, 3])
		await click(`button[aria-label="Delete 0"]`)
		expect(silo.getState(recordAtom)[`items`]).toEqual([3])
		await input(`select[aria-label="Type of label"]`, `other`, `change`)
		expect(silo.getState(recordAtom)[`label`]).toBe(`after`)
		await input(`select[aria-label="Type of label"]`, `number`)
		await input(`select[aria-label="Type of label"]`, `number`, `change`)
		expect(silo.getState(recordAtom)).toEqual({ label: 0, items: [3] })
		await click(`button[aria-label="Add property"]`)
		expect(silo.getState(recordAtom)).toEqual({
			label: 0,
			items: [3],
			new: null,
		})
	})
	it(`reorders only writable array items and cancels stale or abandoned drags`, async () => {
		const { silo, host, mount, click } = fixture()
		const original = [`first`, , `third`, [`nested`]]
		Object.assign(original, { note: `extra property` })
		const listAtom = silo.atom<readonly unknown[]>({
			key: `list`,
			default: original,
		})
		silo.atom<unknown[]>({ key: `other`, default: [`elsewhere`] })
		silo.selector<readonly unknown[]>({
			key: `readonly`,
			get: ({ get }) => get(listAtom),
		})
		mount()
		await click(`[aria-label="Expand list"]`)
		await click(`[aria-label="Expand other"]`)
		const row = (index: number) =>
			host.querySelector<HTMLElement>(
				`[data-testid="list-state-editor"] > json-properties > [data-array-index="${index}"]`,
			)!
		const handle = (index: number) =>
			row(index).querySelector(`button[data-array-handle]`)!
		const transfer = new DataTransfer()
		const drag = (
			node: Element,
			type: string,
			dataTransfer: DataTransfer | null = transfer,
			relatedTarget: Element | null = null,
		) => {
			const event = new DragEvent(type, { bubbles: true, cancelable: true })
			Object.defineProperties(event, {
				dataTransfer: { value: dataTransfer },
				relatedTarget: { value: relatedTarget },
			})
			node.dispatchEvent(event)
			return event
		}
		drag(handle(0), `dragstart`, null)
		expect(drag(row(2), `dragover`).defaultPrevented).toBe(false)
		expect(drag(row(2), `drop`).defaultPrevented).toBe(false)
		drag(handle(0), `dragstart`)
		const alternate = host.querySelector(
			`[data-testid="other-state-editor"] [data-array-handle]`,
		)!
		expect(drag(alternate, `dragover`).defaultPrevented).toBe(false)
		expect(drag(alternate, `drop`).defaultPrevented).toBe(false)
		const actions = row(0).parentElement!.querySelector(`editor-actions`)!
		expect(drag(actions, `dragover`).defaultPrevented).toBe(false)
		drag(row(0), `dragover`)
		drag(row(0), `drop`)
		expect(silo.getState(listAtom)).toBe(original)

		drag(handle(0), `dragstart`)
		drag(row(2), `dragover`, null)
		drag(row(2), `dragover`)
		expect(row(2).dataset[`arrayDrop`]).toBe(`after`)
		drag(row(2), `dragleave`, transfer, handle(2))
		expect(row(2).dataset[`arrayDrop`]).toBe(`after`)
		drag(row(2), `dragleave`)
		expect(row(2).dataset[`arrayDrop`]).toBeUndefined()
		drag(row(2), `drop`)
		await tick()
		expect(silo.getState(listAtom)).toEqual([, `third`, `first`, [`nested`]])
		expect(0 in silo.getState(listAtom)).toBe(false)
		expect(original[0]).toBe(`first`)
		drag(handle(2), `dragstart`)
		drag(row(1), `dragover`)
		expect(row(1).dataset[`arrayDrop`]).toBe(`before`)
		drag(handle(2), `dragend`)
		expect(row(1).dataset[`arrayDrop`]).toBeUndefined()
		drag(handle(2), `dragstart`)
		const replacement = [0, 1, 2, 3]
		silo.setState(listAtom, replacement)
		await tick()
		drag(row(1), `drop`)
		expect(silo.getState(listAtom)).toBe(replacement)
		const press = (index: number, key: string, altKey = true) => {
			handle(index).dispatchEvent(
				new KeyboardEvent(`keydown`, { key, altKey, bubbles: true }),
			)
		}
		press(0, `ArrowDown`, false)
		press(0, `ArrowLeft`)
		press(0, `ArrowUp`)
		expect(silo.getState(listAtom)).toBe(replacement)
		press(0, `ArrowDown`)
		await tick()
		expect(silo.getState(listAtom)).toEqual([1, 0, 2, 3])
		expect(document.activeElement).toBe(handle(1))
		press(1, `ArrowUp`)
		await tick()
		expect(silo.getState(listAtom)).toEqual(replacement)
		await click(`[data-testid="view-selectors"]`)
		await click(`[aria-label="Expand readonly"]`)
		expect(host.querySelector(`[data-array-handle]`)).toBeNull()
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
		expect(host.querySelectorAll(`state-leaf input`).length).toBe(1)
		silo.getState(silo.findState(itemAtoms, `second`))
		await tick()
		expect(host.querySelectorAll(`state-leaf input`).length).toBe(2)
		const dispose = [...host.querySelectorAll(`button`)].find(
			(button) => button.getAttribute(`aria-label`) === `Dispose ${first.key}`,
		)!
		dispose.click()
		await tick()
		expect(host.querySelectorAll(`state-leaf input`).length).toBe(1)
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
		const panel = host.querySelector<HTMLElement>(`debugger-panel`)!
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
		expect(host.querySelector(`[data-index]`)).toBeNull()
		expect(host.querySelectorAll(`brand-mark`)).toHaveLength(1)
		expect(
			host.querySelector(`[aria-label="Open debugger"] brand-mark`),
		).not.toBeNull()
		root.dispose()
		mount(true)
		expect(host.querySelector<HTMLElement>(`debugger-panel`)!.hidden).toBe(false)
		expect(host.querySelector(`[data-index]`)).toBeNull()
		document.dispatchEvent(
			new KeyboardEvent(`keydown`, {
				ctrlKey: true,
				shiftKey: true,
				code: `KeyA`,
			}),
		)
		await tick()
		expect(host.querySelector<HTMLElement>(`debugger-panel`)!.hidden).toBe(true)
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
it(`keeps the default window clamped on viewport resize and supports hiding`, async () => {
	const { host, mount, click } = fixture()
	localStorage.setItem(`🔍 Devtools View`, `"invalid"`)
	const root = mount()
	const panel = host.querySelector<HTMLElement>(`debugger-panel`)!
	const before = panel.style.cssText
	window.dispatchEvent(new Event(`resize`))
	await tick()
	expect(panel.style.cssText).toBe(before)
	await click(`[aria-label="Hide debugger (Ctrl+Shift+A)"]`)
	expect(panel.hidden).toBe(true)
	root.dispose()
})
it(`renders without explicit options and handles empty indexes`, async () => {
	const host = document.createElement(`div`)
	roots.push(render(() => <AtomIODevtools />, host))
	expect(host.querySelector(`debugger-panel`)).not.toBeNull()
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
	await input(`[aria-label="Rename a"]`, `b`, `focusout`)
	expect(host.querySelector(`[role="alert"]`)!.textContent).toContain(
		`already exists`,
	)
	await input(`[aria-label="Rename a"]`, `a`, `focusout`)
	expect(host.querySelector(`[role="alert"]`)).toBeNull()
	await input(`[aria-label="a"]`, `not a number`)
	expect(silo.getState(recordAtom).a).toBe(1)
	await input(`[aria-label="a"]`, ``)
	host
		.querySelector(`[aria-label="a"]`)!
		.dispatchEvent(new FocusEvent(`focusout`))
	expect(
		(host.querySelector(`[aria-label="a"]`) as HTMLInputElement).value,
	).toBe(`1`)
	const flag = host.querySelector<HTMLInputElement>(`[aria-label="flag"]`)!
	flag.checked = true
	flag.dispatchEvent(new Event(`change`))
	await tick()
	expect(silo.getState(recordAtom).flag).toBe(true)
	await click(`button[aria-label="Add property"]`)
	expect(silo.getState(recordAtom).new_).toBe(null)
	await click(`[aria-label="Delete new_"]`)
	expect(silo.getState(recordAtom)).not.toHaveProperty(`new_`)
	await click(`[aria-label="Expand list"]`)
	await input(`[aria-label="0"]`, `b`)
	expect(silo.getState(recordAtom).list).toEqual([`b`, `a`, 3])
	await click(`button[aria-label="Sort"]`)
	expect(silo.getState(recordAtom).list).toEqual([`a`, `b`, 3])
	await click(`button[aria-label="Add item"]`)
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
	await click(`event-view button`)
	expect(host.textContent).not.toContain(`params:`)
	await click(`[data-testid="view-timelines"]`)
	expect(host.querySelector(`[data-testid="timeline-👁‍🗨 internal"]`)).toBeNull()
})
it(`provides roving view tabs with wrapped arrows and Home/End navigation`, async () => {
	const { host } = fixture()
	roots.push(render(() => <AtomIODevtools />, host))
	const tabs = [...host.querySelectorAll<HTMLButtonElement>(`[role="tab"]`)]
	const key = async (value: string) => {
		;(document.activeElement as HTMLElement).dispatchEvent(
			new KeyboardEvent(`keydown`, {
				key: value,
				bubbles: true,
				cancelable: true,
			}),
		)
		await tick()
	}
	expect(tabs.map((tab) => tab.textContent)).toEqual([
		`ecology`,
		`atoms`,
		`selectors`,
		`transactions`,
		`timelines`,
	])
	expect(tabs[0].getAttribute(`aria-selected`)).toBe(`true`)
	tabs[0].focus()
	await key(`ArrowRight`)
	expect(document.activeElement).toBe(tabs[1])
	expect(tabs[1].getAttribute(`aria-selected`)).toBe(`true`)
	await key(`ArrowLeft`)
	expect(document.activeElement).toBe(tabs[0])
	await key(`ArrowLeft`)
	expect(document.activeElement).toBe(tabs[4])
	await key(`ArrowRight`)
	expect(document.activeElement).toBe(tabs[0])
	await key(`End`)
	expect(document.activeElement).toBe(tabs[4])
	await key(`Home`)
	expect(document.activeElement).toBe(tabs[0])
	await key(`Escape`)
	expect(document.activeElement).toBe(tabs[0])
	expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([tabs[0]])
	expect(
		host.querySelector(`[role="tabpanel"]`)!.getAttribute(`aria-labelledby`),
	).toBe(tabs[0].id)
})
it(`resizes elastic rename drafts without committing or replacing the field`, async () => {
	const { silo, host, mount, click, input } = fixture()
	const renameAtom = silo.atom<{ a: number }>({
		key: `rename`,
		default: { a: 1 },
	})
	mount()
	await click(`[aria-label="Expand rename"]`)
	const field = host.querySelector<HTMLInputElement>(`[aria-label="Rename a"]`)!
	await input(`[aria-label="Rename a"]`, `a much longer name`)
	expect(field.size).toBe(18)
	expect(silo.getState(renameAtom)).toEqual({ a: 1 })
	await input(`[aria-label="Rename a"]`, ``)
	expect(field.size).toBe(1)
	await input(`[aria-label="Rename a"]`, `renamed`, `focusout`)
	expect(silo.getState(renameAtom)).toEqual({ renamed: 1 })
})
