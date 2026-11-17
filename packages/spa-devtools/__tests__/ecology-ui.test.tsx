import { Silo } from "atom.io"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { mountAtomIODevtools } from "../src/AtomIODevtools.tsx"

let dispose = () => {}
beforeEach(() => {
	vi.useFakeTimers()
	localStorage.clear()
	localStorage.setItem(`🔍 Devtools View`, JSON.stringify(`ecology`))
})
afterEach(() => {
	dispose()
	document.body.replaceChildren()
	vi.useRealTimers()
	localStorage.clear()
})
async function settle(): Promise<void> {
	for (let index = 0; index < 5; index++) await Promise.resolve()
	await vi.runAllTimersAsync()
	for (let index = 0; index < 5; index++) await Promise.resolve()
}
function setup() {
	const silo = new Silo({
		name: `graph-ui`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const host = document.createElement(`div`)
	document.body.append(host)
	const mount = () => {
		dispose = mountAtomIODevtools(host, { store: silo.store }).dispose
	}
	const click = async (text: string) => {
		const target = [...host.querySelectorAll<HTMLButtonElement>(`button`)].find(
			(entry) =>
				entry.textContent === text || entry.getAttribute(`aria-label`) === text,
		)!
		expect(target, text).toBeDefined()
		target.click()
		await settle()
	}
	const select = async (id: string, key?: string) => {
		const target = [
			...host.querySelectorAll<SVGElement>(`g[data-graph-id]`),
		].find((entry) => entry.dataset[`graphId`] === id)!
		expect(target, id).toBeDefined()
		target.dispatchEvent(
			key
				? new KeyboardEvent(`keydown`, { key, bubbles: true, cancelable: true })
				: new MouseEvent(`click`, { bubbles: true }),
		)
		await settle()
	}
	const search = async (value: string) => {
		const input = host.querySelector<HTMLInputElement>(
			`[aria-label="Search ecology"]`,
		)!
		input.value = value
		input.dispatchEvent(new Event(`input`, { bubbles: true }))
		await settle()
	}
	return { silo, host, mount, click, select, search }
}

it(`opens/searches/selects/traces/expands passively and evaluates only the explicit live editor`, async () => {
	const f = setup(),
		lazy = vi.fn(() => 1),
		getter = vi.fn(() => 2)
	f.silo.atom<number>({ key: `lazy`, default: lazy })
	const dormantSelector = f.silo.selector<number>({
		key: `dormant`,
		get: getter,
	})
	const itemsAtoms = f.silo.atomFamily<number, string>({
		key: `items`,
		default: lazy,
	})
	f.silo.store.families.get(itemsAtoms.key)!.create(`a`)
	f.silo.selector<number>({ key: `sum`, get: () => 1 })
	const source = `items("a")`
	f.silo.store.selectorGraph.set(
		{ upstreamSelectorKey: source, downstreamSelectorKey: `sum` },
		{ source },
	)
	f.silo.atomFamily<number, string>({ key: `zero`, default: 0 })
	const before = [...f.silo.store.valueMap],
		graph = f.silo.store.selectorGraph.toJSON()
	f.mount()
	await settle()
	expect(f.host.querySelector(`[data-testid="ecology-view"]`)).not.toBeNull()
	await f.search(`dormant`)
	await f.select(`state:dormant`, `Enter`)
	expect(f.host.querySelector(`.ecology-inspector`)!.textContent).toContain(
		`Readonly selector`,
	)
	await f.click(`Trace observed roots`)
	await f.select(`state:dormant`)
	expect(f.host.textContent).toContain(`Retained trace: incomplete`)
	await f.search(``)
	await f.select(`state:sum`)
	await f.click(`Trace observed roots`)
	await f.select(`family:items`)
	await f.click(`Expand family`)
	expect(f.host.querySelector(`.ecology-counts`)!.textContent).toContain(
		`2 families / 1 members`,
	)
	await f.click(`Collapse family`)
	await f.select(`family:zero`, ` `)
	expect(f.host.textContent).toContain(`0 instantiated members`)
	expect(lazy).not.toHaveBeenCalled()
	expect(getter).not.toHaveBeenCalled()
	expect(
		[...f.silo.store.valueMap].filter(([key]) => !key.startsWith(`🔍 `)),
	).toEqual(before)
	expect(f.silo.store.selectorGraph.toJSON()).toEqual(graph)
	await f.select(`state:dormant`)
	await f.click(`Open live editor (may read/evaluate)`)
	expect(getter).toHaveBeenCalledTimes(1)
	expect(
		f.host.querySelector(`.ecology-live input`)?.hasAttribute(`readonly`),
	).toBe(true)
	f.host
		.querySelector(`.ecology-live input`)!
		.dispatchEvent(
			new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
		)
	await f.click(`Back to passive inspector`)
	expect(getter).toHaveBeenCalledTimes(1)
	expect(f.silo.getState(dormantSelector)).toBe(2)
})

it(`retains selection/pan/expansion across snapshots and navigation; geometry-only events do not relayout`, async () => {
	const f = setup()
	const countAtom = f.silo.atom<unknown>({ key: `count`, default: 1 })
	f.silo.getState(countAtom)
	f.mount()
	await settle()
	await f.select(`state:count`)
	await f.click(`Pan right`)
	await f.click(`Pan down`)
	await f.click(`Zoom in`)
	await f.click(`Zoom out`)
	await f.click(`Pan left`)
	await f.click(`Pan up`)
	await f.click(`Pan right`)
	const transform = f.host
		.querySelector(`.ecology-world`)!
		.getAttribute(`transform`)
	const position = f.host
		.querySelector(`g[data-graph-id]`)!
		.getAttribute(`transform`)
	f.silo.setState(countAtom, `changed`)
	await f.click(`Refresh`)
	expect(
		f.host.querySelector<HTMLElement>(`.ecology`)!.dataset[`newPositions`],
	).toBe(`0`)
	expect(f.host.querySelector(`.ecology-world`)!.getAttribute(`transform`)).toBe(
		transform,
	)
	expect(
		f.host.querySelector(`g[data-graph-id]`)!.getAttribute(`transform`),
	).toBe(position)
	expect(f.host.querySelector(`.ecology-inspector`)!.textContent).toContain(
		`cached string`,
	)
	const jobs = f.host.querySelector<HTMLElement>(`.ecology`)!.dataset[`jobs`]
	window.dispatchEvent(new Event(`resize`))
	await settle()
	expect(f.host.querySelector<HTMLElement>(`.ecology`)!.dataset[`jobs`]).toBe(
		jobs,
	)
	await f.click(`selectors`)
	await f.click(`ecology`)
	expect(f.host.querySelector(`.ecology-inspector h2`)!.textContent).toBe(
		`count`,
	)
	expect(f.host.querySelector(`.ecology-world`)!.getAttribute(`transform`)).toBe(
		transform,
	)
	await f.click(`Fit`)
	await f.click(`Reset view`)
	expect(f.host.querySelector(`.ecology-world`)!.getAttribute(`transform`)).toBe(
		`translate(0 0) scale(1)`,
	)
	await f.click(`Trace observed roots`)
	f.host.querySelector(`.ecology`)!.dispatchEvent(
		new KeyboardEvent(`keydown`, {
			key: `Escape`,
			bubbles: true,
			cancelable: true,
		}),
	)
	await settle()
	expect(f.host.querySelector(`.ecology-inspector`)!.textContent).toContain(
		`Not traced`,
	)
	await f.click(`Clear selection`)
	expect(f.host.textContent).toContain(`Select a node`)
})

it(`cleans up hidden, minimized, superseded and disposed jobs and keeps empty flows accessible`, async () => {
	const f = setup()
	f.mount()
	const input = f.host.querySelector<HTMLInputElement>(
		`[aria-label="Search ecology"]`,
	)!
	for (const value of [`stale`, `new`, ``]) {
		input.value = value
		input.dispatchEvent(new Event(`input`, { bubbles: true }))
	}
	await settle()
	expect(f.host.querySelector<HTMLElement>(`.ecology`)!.dataset[`jobs`]).toBe(
		`1`,
	)
	await f.click(`Fit`)
	await f.click(`Clear selection`)
	const form = f.host.querySelector(`form`)!
	expect(
		form.dispatchEvent(new Event(`submit`, { bubbles: true, cancelable: true })),
	).toBe(false)
	f.host
		.querySelector(`.ecology-counts`)!
		.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
	input.dispatchEvent(new KeyboardEvent(`keydown`, { key: `x`, bubbles: true }))
	await f.click(`Minimize debugger`)
	expect(f.host.querySelector(`.ecology`)).toBeNull()
	await f.click(`Open debugger`)
	f.host
		.querySelector<HTMLElement>(`[aria-label="Hide debugger (Ctrl+Shift+A)"]`)!
		.click()
	await settle()
	expect(f.host.querySelector(`.ecology`)).toBeNull()
	document.dispatchEvent(
		new KeyboardEvent(`keydown`, {
			key: `A`,
			code: `KeyA`,
			ctrlKey: true,
			shiftKey: true,
		}),
	)
	await settle()
	expect(f.host.querySelector(`.ecology`)).not.toBeNull()
	input.dispatchEvent(new Event(`input`, { bubbles: true })) // Detached view listener has been removed.
	dispose()
	await settle()
	expect(f.host.childNodes.length).toBe(0)
	expect(vi.getTimerCount()).toBe(0)
})

it(`reuses the live editor for writable state, handles disposed selection and preserves passive metadata after filtering`, async () => {
	const f = setup()
	const countAtom = f.silo.atom<number>({ key: `count`, default: 1 })
	const itemsAtoms = f.silo.atomFamily<number, string>({
		key: `items`,
		default: 1,
	})
	const member = f.silo.store.families.get(itemsAtoms.key)!.create(`a`)
	f.mount()
	await settle()
	await f.select(`state:count`)
	await f.click(`Open live editor (may read/evaluate)`)
	const input = f.host.querySelector<HTMLInputElement>(
		`.ecology-live input[aria-label="count"]`,
	)!
	input.value = `2.`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	await settle()
	expect(input.value).toBe(`2.`)
	expect(f.silo.getState(countAtom)).toBe(2)
	await f.click(`Back to passive inspector`)
	await f.search(`absent`)
	expect(f.host.querySelector(`.ecology-inspector h2`)!.textContent).toBe(
		`count`,
	)
	await f.search(``)
	await f.select(`family:items`)
	await f.click(`Expand family`)
	await f.select(`state:${member.key}`)
	f.silo.disposeState(itemsAtoms, `a`)
	await f.click(`Open live editor (may read/evaluate)`)
	expect(f.host.textContent).toContain(`State was disposed`)
	await f.click(`Back to passive inspector`)
	f.host
		.querySelector<SVGElement>(`g[data-graph-id][aria-pressed="true"]`)!
		.focus()
	await f.click(`Refresh`)
	expect(f.host.textContent).toContain(`Select a node`)
	expect(document.activeElement?.getAttribute(`aria-label`)).toBe(
		`Search ecology`,
	)
})

it(`shows capture/adjacency uncertainty and keeps an uncaptured valid selection instead of calling it disposed`, async () => {
	const f = setup()
	const family = { key: `many`, default: 0 }
	const manyAtoms = f.silo.atomFamily<number, number>(family)
	f.silo.selector<number>({ key: `wide`, get: () => 0 })
	f.mount()
	await settle()
	await f.select(`state:wide`)
	const related = new Set(
		Array.from({ length: 50_001 }, (_, index) => `missing${index}`),
	)
	f.silo.store.selectorGraph.relations.set(`wide`, related)
	await f.click(`Refresh`)
	expect(f.host.querySelector(`.ecology-inspector`)!.textContent).toContain(
		`(truncated)`,
	)
	expect(f.host.querySelector(`.ecology-notice`)!.textContent).toContain(
		`full store totals unknown`,
	)
	for (let index = 0; index < 10_001; index++)
		f.silo.store.families.get(manyAtoms.key)!.create(index)
	await f.click(`Refresh`)
	expect(f.host.querySelector(`.ecology-inspector`)!.textContent).toContain(
		`Selection outside this captured snapshot`,
	)
	await f.select(`family:many`)
	expect(f.host.querySelector(`.ecology-inspector`)!.textContent).toContain(
		`+ instantiated members`,
	)
})

it(`preserves keyboard focus during trace and family refresh and clears stale trace when selection changes`, async () => {
	const f = setup()
	f.silo.atom<number>({ key: `a`, default: 0 })
	f.silo.selector<number>({ key: `s`, get: () => 0 })
	f.silo.store.selectorGraph.set(
		{ upstreamSelectorKey: `a`, downstreamSelectorKey: `s` },
		{ source: `a` },
	)
	f.mount()
	await settle()
	await f.select(`state:s`)
	const trace = [...f.host.querySelectorAll<HTMLButtonElement>(`button`)].find(
		(button) => button.textContent === `Trace observed roots`,
	)!
	trace.focus()
	trace.click()
	await settle()
	expect(document.activeElement?.textContent).toBe(`Trace observed roots`)
	const graph = f.host.querySelector<SVGElement>(`g[data-graph-id="state:s"]`)!
	graph.focus()
	await f.click(`Refresh`)
	expect(document.activeElement?.getAttribute(`data-graph-id`)).toBe(`state:s`)
	await f.select(`state:a`)
	expect(f.host.querySelector(`.ecology-inspector`)!.textContent).toContain(
		`Not traced`,
	)
	expect(f.host.querySelectorAll(`.traced`)).toHaveLength(0)
})
