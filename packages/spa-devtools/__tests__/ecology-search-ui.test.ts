import { Silo } from "atom.io"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { mountAtomIODevtools } from "../src/mount.ts"
import { mountEcologyFixture } from "./fixtures/views.tsx"

let dispose = () => {}
beforeEach(() => {
	vi.useFakeTimers({
		toFake: [
			`setTimeout`,
			`clearTimeout`,
			`setInterval`,
			`clearInterval`,
			`Date`,
			`performance`,
		],
	})
	localStorage.clear()
	localStorage.setItem(`🔍 Devtools View`, JSON.stringify(`ecology`))
})
afterEach(() => {
	dispose()
	document.body.replaceChildren()
	vi.useRealTimers()
	vi.restoreAllMocks()
})
async function settle() {
	await vi.dynamicImportSettled()
	for (let i = 0; i < 5; i++) await Promise.resolve()
	await vi.runAllTimersAsync()
	for (let i = 0; i < 5; i++) await Promise.resolve()
}
async function setup() {
	const app = new Silo({
		name: `ecology-ranked-ui`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = app.atom<number>({ key: `count`, default: 2 })
	app.getState(countAtom)
	const itemsAtoms = app.atomFamily<number, string>({ key: `items`, default: 0 })
	app.store.families.get(itemsAtoms.key)!.create(`green-tea`)
	const host = document.createElement(`div`)
	document.body.append(host)
	dispose = mountAtomIODevtools(host, { store: app.store }).dispose
	await settle()
	const input = () =>
		host.querySelector<HTMLInputElement>(`[aria-label="Search ecology"]`)!
	const button = (name: string) =>
		[...host.querySelectorAll<HTMLButtonElement>(`button`)].find(
			(node) =>
				node.textContent === name || node.getAttribute(`aria-label`) === name,
		)!
	const query = async (text: string) => {
		input().focus()
		input().value = text
		input().dispatchEvent(new Event(`input`, { bubbles: true }))
		await settle()
	}
	const key = async (target: Element, name: string, extra = {}) => {
		const e = new KeyboardEvent(`keydown`, {
			key: name,
			bubbles: true,
			cancelable: true,
			...extra,
		})
		target.dispatchEvent(e)
		await settle()
		return e
	}
	const select = async (id: string) => {
		;[
			...host.querySelectorAll<HTMLElement>(
				`ecology-node-card > button[data-graph-id]`,
			),
		]
			.find((node) => node.dataset[`graphId`] === id)!
			.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
		await settle()
	}
	return { app, countAtom, itemsAtoms, host, input, button, query, key, select }
}

it(`switches compact graph, list and selection without replacing the live draft or capture`, async () => {
	const f = await setup()
	const panel = f.host.querySelector<HTMLElement>(`debugger-panel`)!
	const width = vi.spyOn(panel, `clientWidth`, `get`).mockReturnValue(500)
	const graph = f.host.querySelector<HTMLElement>(`ecology-view`)!
	const captured = graph.dataset[`snapshotMs`]
	await f.select(`state:count`)
	expect(graph.dataset[`workspace`]).toBe(`selection`)
	expect(document.activeElement).toBe(
		f.host.querySelector(`ecology-body > aside h2`),
	)
	f.button(`Open live editor (may read/evaluate)`).click()
	await settle()
	const editor = f.host.querySelector<HTMLInputElement>(`ecology-live input`)!
	editor.focus()
	editor.value = `2e`
	editor.dispatchEvent(new Event(`input`, { bubbles: true }))
	for (const view of [`Node list`, `Graph`, `Selection`]) {
		f.button(view).focus()
		f.button(view).click()
		await settle()
		expect(f.button(view).getAttribute(`aria-pressed`)).toBe(`true`)
		expect(f.host.querySelector(`ecology-live input`)).toBe(editor)
		expect(editor.value).toBe(`2e`)
	}
	expect(
		f.host.querySelector<HTMLDetailsElement>(`ecology-map details`)!.open,
	).toBe(true)
	await f.query(`green tea`)
	f.host
		.querySelector<HTMLButtonElement>(`ecology-view [data-results] button`)!
		.click()
	await settle()
	expect(graph.dataset[`workspace`]).toBe(`selection`)
	expect(document.activeElement).toBe(
		f.host.querySelector(`ecology-body > aside h2`),
	)
	expect(editor.value).toBe(`2e`)
	await f.key(document.activeElement!, `Escape`)
	expect(document.activeElement).toBe(f.input())
	expect(f.app.getState(f.countAtom)).toBe(2)
	expect(graph.dataset[`snapshotMs`]).toBe(captured)
	f.button(`Graph`).click()
	await settle()
	f.button(`Back to passive inspector`).click()
	await settle()
	expect(graph.dataset[`workspace`]).toBe(`selection`)
	expect(document.activeElement).toBe(
		f.button(`Open live editor (may read/evaluate)`),
	)
	width.mockReturnValue(900)
	await f.query(`count`)
	f.host
		.querySelector<HTMLButtonElement>(`ecology-view [data-results] button`)!
		.click()
	await settle()
	expect(document.activeElement?.closest(`ecology-map ul`)).not.toBeNull()
	f.button(`Open live editor (may read/evaluate)`).click()
	await settle()
	f.button(`Clear selection`).click()
	await settle()
	f.button(`Back to passive inspector`).click()
	await settle()
	expect(document.activeElement).toBe(
		f.host.querySelector(`ecology-body > aside`),
	)
})

it(`navigates ranked matches inside collapsed families while preserving pan, expansion and same-node tracing`, async () => {
	const f = await setup()
	f.button(`Pan right`).click()
	await settle()
	f.button(`Zoom in`).click()
	await settle()
	const world = () =>
		f.host.querySelector(`ecology-scene`)!.getAttribute(`data-camera`)
	const before = world(),
		jobs =
			f.host.querySelector<HTMLElement>(`ecology-view`)!.dataset[`snapshotMs`]
	await f.query(`GREEN tea`)
	const hit = f.host.querySelector<HTMLButtonElement>(
		`ecology-view [data-results] button`,
	)!
	expect(hit).not.toBeNull()
	await f.key(f.input(), `ArrowDown`)
	expect(document.activeElement).toBe(hit)
	hit.click()
	await settle()
	expect(f.host.querySelector(`ecology-body > aside h2`)!.textContent).toBe(
		`items("green-tea")`,
	)
	expect(document.activeElement?.closest(`ecology-map ul`)).not.toBeNull()
	expect(world()).not.toBe(before)
	expect(world()).not.toContain(`NaN`)
	f.button(`Trace observed roots`).click()
	await settle()
	await f.query(`items green`)
	expect(f.host.querySelector(`ecology-body > aside`)!.textContent).toContain(
		`Retained trace`,
	)
	expect(
		f.host.querySelector<HTMLElement>(`ecology-view`)!.dataset[`snapshotMs`],
	).toBe(jobs)
	await f.query(``)
	await f.select(`family:items`)
	expect(f.button(`Collapse family`)).toBeDefined()
})

it(`explains an empty filter without losing the retained selection or capture`, async () => {
	const f = await setup()
	await f.select(`state:count`)
	const graph = f.host.querySelector<HTMLElement>(`ecology-view`)!
	const snapshot = graph.dataset[`snapshotMs`]
	await f.query(`nothing-in-this-capture`)
	const empty = f.host.querySelector<HTMLElement>(`[data-empty]`)!
	expect(empty.hidden).toBe(false)
	expect(empty.textContent).toContain(`No nodes match this search`)
	expect(
		f.host.querySelector(`[data-selection-context]`)!.textContent,
	).toContain(`Retained selection`)
	expect(f.host.querySelector(`ecology-body > aside h2`)!.textContent).toBe(
		`count`,
	)
	f.button(`Clear search`).click()
	await settle()
	expect(empty.hidden).toBe(true)
	expect(f.host.querySelector(`[data-selection-context]`)).toBeNull()
	expect(graph.dataset[`snapshotMs`]).toBe(snapshot)
	expect(f.app.getState(f.countAtom)).toBe(2)
})

it(`keeps an unfinished numeric draft and its node mounted through query, clear, selection and Refresh`, async () => {
	const f = await setup()
	await f.select(`state:count`)
	f.button(`Open live editor (may read/evaluate)`).click()
	await settle()
	f.button(`Open live editor (may read/evaluate)`).click()
	await settle()
	const editor = f.host.querySelector<HTMLInputElement>(`ecology-live input`)!
	editor.focus()
	editor.value = `1e`
	editor.dispatchEvent(new Event(`input`, { bubbles: true }))
	editor.setSelectionRange(1, 2)
	await f.query(`green tea`)
	f.host
		.querySelector<HTMLButtonElement>(`ecology-view [data-results] button`)!
		.click()
	await settle()
	f.button(`Refresh`).click()
	await settle()
	expect(f.host.querySelector(`ecology-live input`)).toBe(editor)
	expect(editor.value).toBe(`1e`)
	expect(f.app.getState(f.countAtom)).toBe(2)
	await f.key(f.input(), `Escape`)
	await f.key(f.input(), `Escape`)
	expect(document.activeElement).toBe(editor)
	expect(editor.selectionStart).toBe(1)
	f.button(`Back to passive inspector`).focus()
	f.button(`Back to passive inspector`).click()
	await settle()
	expect(f.host.querySelector(`ecology-live input`)).toBeNull()
})

it(`retains invalid-query results, respects IME/native find and never recaptures on a query`, async () => {
	const f = await setup()
	await f.query(`count`)
	const row = f.host.querySelector(
		`ecology-node-card > button[data-graph-id="state:count"]`,
	)
	await f.query(`x`.repeat(257))
	expect(
		f.host.querySelector(`ecology-view [data-search-status]`)!.textContent,
	).toContain(`256`)
	expect(
		f.host.querySelector(
			`ecology-node-card > button[data-graph-id="state:count"]`,
		),
	).toBe(row)
	f.input().value = `items`
	f.input().dispatchEvent(
		new InputEvent(`input`, { isComposing: true, bubbles: true }),
	)
	await settle()
	expect(
		f.host.querySelector(`ecology-view [data-search-status]`)!.textContent,
	).toContain(`256`)
	f.input().dispatchEvent(new Event(`compositionend`, { bubbles: true }))
	await settle()
	expect(
		f.host.querySelectorAll(`ecology-view [data-results] button`).length,
	).toBeGreaterThan(0)
	expect((await f.key(f.input(), `f`, { ctrlKey: true })).defaultPrevented).toBe(
		false,
	)
	f.app.atom<number>({ key: `later`, default: 0 })
	await f.query(`later`)
	expect(
		f.host.querySelectorAll(`ecology-view [data-results] button`),
	).toHaveLength(0)
	f.button(`Refresh`).click()
	await settle()
	expect(
		f.host.querySelectorAll(`ecology-view [data-results] button`),
	).toHaveLength(1)
	f.button(`Clear search`).click()
	await settle()
	expect(f.input().value).toBe(``)
})

it(`shares shortcuts with other views, preserves native modifiers and cancels window Escape before search`, async () => {
	const f = await setup(),
		move = f.button(`Move debugger`)
	move.focus()
	await f.key(move, `/`)
	expect(document.activeElement).toBe(f.input())
	await f.key(f.input(), `Escape`)
	expect(document.activeElement).toBe(move)
	await f.key(move, `f`, { ctrlKey: true, shiftKey: true })
	expect(document.activeElement).toBe(f.input())
	await f.query(`items`)
	const hit = f.host.querySelector<HTMLButtonElement>(
		`ecology-view [data-results] button`,
	)!
	hit.focus()
	await f.key(hit, `Escape`)
	expect(document.activeElement).toBe(f.input())
	const overlay = document.createElement(`div`)
	overlay.dataset[`windowInteraction`] = `true`
	document.body.append(overlay)
	await f.key(f.input(), `Escape`)
	expect(f.input().value).toBe(`items`)
	overlay.remove()
	await f.key(f.input(), `Escape`)
	await f.query(`conut`)
	expect(f.host.textContent).toContain(`approximate match`)
	const input = f.input()
	input.value = `items`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	await f.key(input, `ArrowDown`, { isComposing: true })
	const prevented = new KeyboardEvent(`keydown`, {
		key: `/`,
		bubbles: true,
		cancelable: true,
	})
	prevented.preventDefault()
	input.dispatchEvent(prevented)
	await settle()
	const result = f.host.querySelector<HTMLButtonElement>(
		`ecology-view [data-results] button`,
	)!
	result.focus()
	result.click()
	await settle()
	await f.key(document.activeElement!, `Escape`)
	expect(document.activeElement).toBe(input)
})

it(`uses latest input while metadata indexing is in flight and cancels hidden/disposed work`, async () => {
	const { createGraphContext } = await import(`../src/ecology-graph.ts`)
	const app = new Silo({
		name: `ecology-lifecycle`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	for (let i = 0; i < 80; i++) {
		const options = { key: `record${i}`, default: 0 }
		app.atom<number>(options)
	}
	const panel = document.createElement(`main`)
	let host!: HTMLElement
	document.body.append(panel)
	let clock = 0
	vi.spyOn(performance, `now`).mockImplementation(() => ++clock)
	;({ dispose, host } = mountEcologyFixture(
		panel,
		app.store,
		createGraphContext(),
	))
	const input = host.querySelector(`input`)!
	input.value = `record79`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	await vi.advanceTimersToNextTimerAsync()
	panel.hidden = true
	await settle()
	expect(host.dataset[`jobs`]).toBeUndefined()
	panel.hidden = false
	await settle()
	expect(
		host.querySelector(`ecology-view [data-results] button`)!.textContent,
	).toBe(`record79`)
	const jobs = host.dataset[`jobs`]
	panel.dataset[`open`] = `false`
	await settle()
	input.value = `record1`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	host.querySelector<HTMLButtonElement>(`[data-action="refresh"]`)!.click()
	await settle()
	expect(host.dataset[`jobs`]).toBe(jobs)
	panel.dataset[`open`] = `true`
	await settle()
	expect(host.dataset[`jobs`]).not.toBe(jobs)
	input.value = `record2`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	const old = host.querySelector<HTMLButtonElement>(
		`ecology-view [data-results] button`,
	)!
	old.click()
	await settle()
	input.dispatchEvent(
		new KeyboardEvent(`keydown`, { key: `ArrowDown`, bubbles: true }),
	)
	dispose()
	await settle()
	expect(vi.getTimerCount()).toBe(0)
})

it(`waits for a committed root and can clear selection before the first admitted capture`, async () => {
	const { createGraphContext } = await import(`../src/ecology-graph.ts`)
	const app = new Silo({
		name: `ecology-transaction`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const captureTransaction = app.transaction<() => void>({
		key: `capture`,
		do: () => {},
	})
	const panel = document.createElement(`main`)
	let host!: HTMLElement
	document.body.append(panel)
	const stop = app.store.on.transactionApplying.subscribe(
		`mount-search`,
		(applying) => {
			if (applying !== null) {
				;({ dispose, host } = mountEcologyFixture(
					panel,
					app.store,
					createGraphContext(),
				))
				host.querySelector<HTMLButtonElement>(`[data-action="clear"]`)!.click()
				expect(host.textContent).toContain(`Waiting for the current transaction`)
			}
		},
	)
	app.runTransaction(captureTransaction)()
	stop()
	await settle()
	expect(host.dataset[`ready`]).toBe(`true`)
})

it(`closes a disposed live member on Refresh without applying the unfinished draft`, async () => {
	const f = await setup()
	await f.query(`green tea`)
	f.host
		.querySelector<HTMLButtonElement>(`ecology-view [data-results] button`)!
		.click()
	await settle()
	f.button(`Open live editor (may read/evaluate)`).click()
	await settle()
	const editor = f.host.querySelector<HTMLInputElement>(`ecology-live input`)!
	editor.focus()
	editor.value = `1e`
	editor.dispatchEvent(new Event(`input`, { bubbles: true }))
	await f.query(`items`)
	f.app.disposeState(f.itemsAtoms, `green-tea`)
	f.button(`Refresh`).click()
	await settle()
	expect(editor.isConnected).toBe(false)
	expect(f.host.querySelector<HTMLElement>(`ecology-live-panel`)!.hidden).toBe(
		true,
	)
})

it(`reports incomplete snapshots, truncated prefixes and bounded approximate matching in the search status`, async () => {
	const { createGraphContext } = await import(`../src/ecology-graph.ts`)
	const app = new Silo({
		name: `ecology-limits-ui`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const options = { key: `long`.repeat(1000), default: 0 }
	app.atom<number>(options)
	for (let i = 0; i < 10001; i++) {
		const optionsForMember = { key: `${`a`.repeat(61)}b-${i}`, default: 0 }
		app.atom<number>(optionsForMember)
	}
	const panel = document.createElement(`main`)
	let host!: HTMLElement
	document.body.append(panel)
	const context = createGraphContext()
	context.query = `${`a`.repeat(61)}c `.repeat(4).trim()
	;({ dispose, host } = mountEcologyFixture(panel, app.store, context))
	await settle()
	expect(
		host.querySelector(`ecology-view [data-notice]`)!.textContent,
	).toContain(`full store totals unknown`)
	expect(
		host.querySelector(`ecology-view [data-search-status]`)!.textContent,
	).toContain(`text prefixes truncated`)
	expect(
		host.querySelector(`ecology-view [data-search-status]`)!.textContent,
	).toContain(`Approximate search limited`)
	expect(
		host.querySelectorAll(`ecology-view [data-results] button`),
	).toHaveLength(100)
})

it(`reuses visible slots across filters, preserves logical focus and invalidates slots on Refresh`, async () => {
	const f = await setup()
	await f.query(`count`)
	const original = f.host.querySelector<HTMLElement>(
		`ecology-node-card > button[data-graph-id="state:count"]`,
	)!
	const row = f.host.querySelector(`ecology-map ul button`)!
	const world = f.host.querySelector(`ecology-scene`)
	await f.query(`green tea`)
	expect(f.host.querySelector(`ecology-node-card > button[data-graph-id]`)).toBe(
		original,
	)
	expect(original.getAttribute(`data-graph-id`)).toBe(`family:items`)
	await f.query(`count`)
	expect(f.host.querySelector(`ecology-map ul button`)).toBe(row)
	original.focus()
	f.input().value = ``
	f.input().dispatchEvent(new Event(`input`, { bubbles: true }))
	await settle()
	expect(document.activeElement?.getAttribute(`data-graph-id`)).toBe(
		`state:count`,
	)
	expect(f.host.querySelector(`ecology-scene`)).toBe(world)
	await f.query(`count`)
	const current = f.host.querySelector(
		`ecology-node-card > button[data-graph-id]`,
	)
	f.button(`Refresh`).click()
	await settle()
	expect(
		f.host.querySelector(`ecology-node-card > button[data-graph-id]`),
	).not.toBe(current)
})

it(`bounds retained cards when successive filters visit disjoint parts of a large snapshot`, async () => {
	const f = await setup()
	for (const group of [`alpha`, `beta`, `gamma`])
		for (let i = 0; i < 500; i++) {
			const options = { key: `${group}${i}`, default: 0 }
			f.app.atom<number>(options)
		}
	f.button(`Refresh`).click()
	await settle()
	for (const group of [`alpha`, `beta`]) {
		await f.query(group)
		expect(
			f.host.querySelectorAll(`ecology-node-card > button[data-graph-id]`),
		).toHaveLength(500)
		expect(
			Number(
				f.host.querySelector<HTMLElement>(`ecology-view`)!.dataset[
					`retainedCards`
				],
			),
		).toBeLessThanOrEqual(500)
	}
	await f.query(`gamma499`)
	f.host
		.querySelector<HTMLButtonElement>(`ecology-view [data-results] button`)!
		.click()
	await settle()
	await f.query(`a`)
	expect(
		Number(
			f.host.querySelector<HTMLElement>(`ecology-view`)!.dataset[
				`retainedCards`
			],
		),
	).toBeLessThanOrEqual(500)
	expect(
		f.host
			.querySelector(
				`ecology-node-card > button[data-graph-id="state:gamma499"]`,
			)!
			.getAttribute(`aria-pressed`),
	).toBe(`true`)
})
