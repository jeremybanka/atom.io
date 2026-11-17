import { Silo } from "atom.io"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { mountAtomIODevtools } from "../src/mount.ts"

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
	localStorage.clear()
})
async function settle(): Promise<void> {
	await vi.dynamicImportSettled()
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
			...host.querySelectorAll<HTMLElement>(
				`ecology-node-card > button[data-graph-id]`,
			),
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
	f.silo.selectorFamily<number, string>({ key: `derived`, get: () => getter })
	const before = [...f.silo.store.valueMap],
		graph = f.silo.store.selectorGraph.toJSON()
	f.mount()
	await settle()
	expect(f.host.querySelector(`[data-testid="ecology-view"]`)).not.toBeNull()
	const labels = [...f.host.querySelectorAll(`ecology-node-card small`)].map(
		(node) => node.textContent,
	)
	for (const category of [`Atom`, `Atom Family`, `Selector`, `Selector Family`])
		expect(labels.some((label) => label?.startsWith(`${category} · `))).toBe(
			true,
		)
	await f.search(`dormant`)
	await f.select(`state:dormant`, `Enter`)
	expect(f.host.querySelector(`ecology-body > aside`)!.textContent).toContain(
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
	expect(
		f.host.querySelector(`ecology-view [data-counts]`)!.textContent,
	).toContain(`3 families / 1 members`)
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
		f.host.querySelector(`ecology-live input`)?.hasAttribute(`readonly`),
	).toBe(true)
	f.host
		.querySelector(`ecology-live input`)!
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
		.querySelector(`ecology-scene`)!
		.getAttribute(`data-camera`)
	const position = f.host
		.querySelector(`ecology-node-card`)!
		.getAttribute(`data-position`)
	f.silo.setState(countAtom, `changed`)
	await f.click(`Refresh`)
	expect(
		f.host.querySelector<HTMLElement>(`ecology-view`)!.dataset[`newPositions`],
	).toBe(`0`)
	expect(
		f.host
			.querySelector(`ecology-scene`)!
			.getAttribute(`data-camera`)!
			.split(`,`)
			.map(Number),
	).toEqual(
		transform!.split(`,`).map((value) => expect.closeTo(Number(value), 10)),
	)
	expect(
		f.host.querySelector(`ecology-node-card`)!.getAttribute(`data-position`),
	).toBe(position)
	expect(f.host.querySelector(`ecology-body > aside`)!.textContent).toContain(
		`cached string`,
	)
	const jobs = f.host.querySelector<HTMLElement>(`ecology-view`)!.dataset[`jobs`]
	window.dispatchEvent(new Event(`resize`))
	await settle()
	expect(
		f.host.querySelector<HTMLElement>(`ecology-view`)!.dataset[`jobs`],
	).toBe(jobs)
	await f.click(`selectors`)
	await f.click(`ecology`)
	expect(f.host.querySelector(`ecology-body > aside h2`)!.textContent).toBe(
		`count`,
	)
	expect(
		f.host
			.querySelector(`ecology-scene`)!
			.getAttribute(`data-camera`)!
			.split(`,`)
			.map(Number),
	).toEqual(
		transform!.split(`,`).map((value) => expect.closeTo(Number(value), 10)),
	)
	await f.click(`Fit`)
	await f.click(`Reset view`)
	expect(
		f.host.querySelector(`ecology-scene`)!.getAttribute(`data-camera`),
	).not.toContain(`NaN`)
	await f.click(`Trace observed roots`)
	f.host.querySelector(`ecology-view`)!.dispatchEvent(
		new KeyboardEvent(`keydown`, {
			key: `Escape`,
			bubbles: true,
			cancelable: true,
		}),
	)
	await settle()
	expect(f.host.querySelector(`ecology-body > aside`)!.textContent).toContain(
		`Select a node`,
	)
	await f.click(`Clear selection`)
	expect(f.host.textContent).toContain(`Select a node`)
})

it(`automatically emphasizes selection paths, dims unrelated cards, and clears selection before the search on Escape`, async () => {
	const f = setup(),
		read = vi.fn(() => 1)
	f.silo.atom<number>({ key: `a`, default: read })
	f.silo.atom<number>({ key: `b`, default: read })
	for (const key of [`s`, `t`, `side`])
		f.silo.selector<number>({ key, get: read })
	for (const [dependency, selector] of [
		[`a`, `s`],
		[`b`, `s`],
		[`s`, `t`],
		[`a`, `side`],
	]) {
		f.silo.store.selectorGraph.set(
			{ upstreamSelectorKey: dependency, downstreamSelectorKey: selector },
			{ source: dependency },
		)
	}
	f.mount()
	await settle()
	await f.select(`state:s`)
	const card = (key: string) =>
		f.host.querySelector<HTMLElement>(
			`ecology-node-card:has([data-graph-id="state:${key}"])`,
		)!
	for (const key of [`a`, `b`, `s`, `t`]) {
		expect(card(key).dataset[`traced`]).toBe(`true`)
		expect(card(key).dataset[`dimmed`]).toBe(`false`)
	}
	expect(card(`side`).dataset[`dimmed`]).toBe(`true`)
	await f.search(`s`)
	const input = f.host.querySelector<HTMLInputElement>(
		`[aria-label="Search ecology"]`,
	)!
	input.dispatchEvent(
		new KeyboardEvent(`keydown`, {
			key: `Escape`,
			bubbles: true,
			cancelable: true,
		}),
	)
	await settle()
	expect(input.value).toBe(`s`)
	expect(f.host.querySelector(`ecology-body > aside h2`)).toBeNull()
	await f.search(``)
	expect(
		[...f.host.querySelectorAll<HTMLElement>(`ecology-node-card`)].every(
			(node) => node.dataset[`dimmed`] === `false`,
		),
	).toBe(true)
	expect(read).not.toHaveBeenCalled()
	const scene = f.host.querySelector(`ecology-scene`)!
	scene.dispatchEvent(
		new KeyboardEvent(`keydown`, {
			key: `Escape`,
			bubbles: true,
			cancelable: true,
		}),
	)
	await settle()
	expect(f.host.querySelector(`ecology-body > aside h2`)).toBeNull()
	f.host.querySelector(`ecology-map ul button`)!.dispatchEvent(
		new KeyboardEvent(`keydown`, {
			key: `Escape`,
			bubbles: true,
			cancelable: true,
		}),
	)
	await settle()
	expect(document.activeElement).toBe(input)
})

it(`expands a selected family with Enter from its card, heading and graph without toggling it closed`, async () => {
	const f = setup()
	const familyAtoms = f.silo.atomFamily<number, string>({
		key: `family`,
		default: 0,
	})
	f.silo.store.families.get(familyAtoms.key)!.create(`one`)
	f.mount()
	await settle()
	await f.select(`family:family`)
	await f.select(`family:family`, `ArrowDown`)
	expect(f.host.textContent).toContain(`Expand family`)
	await f.select(`family:family`, `Enter`)
	expect(f.host.textContent).toContain(`Collapse family`)
	await f.select(`family:family`, `Enter`)
	expect(f.host.textContent).toContain(`Collapse family`)
	for (const selector of [`ecology-body > aside h2`, `ecology-scene`]) {
		await f.click(`Collapse family`)
		f.host.querySelector(selector)!.dispatchEvent(
			new KeyboardEvent(`keydown`, {
				key: `Enter`,
				bubbles: true,
				cancelable: true,
			}),
		)
		await settle()
		expect(f.host.textContent).toContain(`Collapse family`)
	}
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
	expect(
		f.host.querySelector<HTMLElement>(`ecology-view`)!.dataset[`jobs`],
	).toBe(`1`)
	await f.click(`Fit`)
	await f.click(`Clear selection`)
	const form = f.host.querySelector(`form`)!
	expect(
		form.dispatchEvent(new Event(`submit`, { bubbles: true, cancelable: true })),
	).toBe(false)
	f.host
		.querySelector(`ecology-view [data-counts]`)!
		.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
	input.dispatchEvent(new KeyboardEvent(`keydown`, { key: `x`, bubbles: true }))
	await f.click(`Minimize debugger`)
	expect(f.host.querySelector(`ecology-view`)).toBeNull()
	await f.click(`Open debugger`)
	f.host
		.querySelector<HTMLElement>(`[aria-label="Hide debugger (Ctrl+Shift+A)"]`)!
		.click()
	await settle()
	expect(f.host.querySelector(`ecology-view`)).toBeNull()
	document.dispatchEvent(
		new KeyboardEvent(`keydown`, {
			key: `A`,
			code: `KeyA`,
			ctrlKey: true,
			shiftKey: true,
		}),
	)
	await settle()
	expect(f.host.querySelector(`ecology-view`)).not.toBeNull()
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
		`ecology-live input[aria-label="count"]`,
	)!
	input.value = `2.`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	await settle()
	expect(input.value).toBe(`2.`)
	expect(f.silo.getState(countAtom)).toBe(2)
	await f.click(`Back to passive inspector`)
	await f.search(`absent`)
	expect(f.host.querySelector(`ecology-body > aside h2`)!.textContent).toBe(
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
		.querySelector<HTMLElement>(
			`ecology-node-card > button[data-graph-id][aria-pressed="true"]`,
		)!
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
	expect(f.host.querySelector(`ecology-body > aside`)!.textContent).toContain(
		`(truncated)`,
	)
	expect(
		f.host.querySelector(`ecology-view [data-notice]`)!.textContent,
	).toContain(`full store totals unknown`)
	for (let index = 0; index < 10_001; index++)
		f.silo.store.families.get(manyAtoms.key)!.create(index)
	await f.click(`Refresh`)
	expect(f.host.querySelector(`ecology-body > aside`)!.textContent).toContain(
		`Selection outside this captured snapshot`,
	)
	await f.select(`family:many`)
	expect(f.host.querySelector(`ecology-body > aside`)!.textContent).toContain(
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
	const graph = f.host.querySelector<HTMLElement>(
		`ecology-node-card > button[data-graph-id="state:s"]`,
	)!
	graph.focus()
	await f.click(`Refresh`)
	expect(document.activeElement?.getAttribute(`data-graph-id`)).toBe(`state:s`)
	await f.select(`state:a`)
	expect(f.host.querySelector(`ecology-body > aside`)!.textContent).toContain(
		`Not traced`,
	)
	expect(f.host.querySelectorAll(`[data-traced="true"]`)).toHaveLength(2)
})

it(`returns focus to search when refreshed selection controls or headings disappear`, async () => {
	const f = setup()
	const membersAtoms = f.silo.atomFamily<number, string>({
		key: `members`,
		default: 0,
	})
	f.silo.store.families.get(membersAtoms.key)!.create(`a`)
	f.mount()
	await settle()
	await f.select(`family:members`)
	const expand = [...f.host.querySelectorAll<HTMLButtonElement>(`button`)].find(
		(button) => button.textContent === `Expand family`,
	)!
	expand.focus()
	const definition = f.silo.store.families.get(membersAtoms.key)!
	f.silo.store.families.delete(membersAtoms.key)
	await f.click(`Refresh`)
	expect(document.activeElement?.getAttribute(`aria-label`)).toBe(
		`Search ecology`,
	)
	await f.select(`state:members("a")`)
	f.host.querySelector<HTMLElement>(`ecology-body > aside h2`)!.focus()
	f.silo.store.families.set(membersAtoms.key, definition)
	f.silo.disposeState(membersAtoms, `a`)
	await f.click(`Refresh`)
	expect(document.activeElement?.getAttribute(`aria-label`)).toBe(
		`Search ecology`,
	)
	expect(f.host.textContent).toContain(`Select a node`)
})

it(`clears family selection safely and ignores result navigation while matching`, async () => {
	const f = setup()
	f.silo.atomFamily<number, string>({ key: `family`, default: 0 })
	f.mount()
	await settle()
	await f.select(`family:family`)
	await f.click(`Clear selection`)
	expect(f.host.querySelector(`ecology-body > aside`)!.textContent).toContain(
		`Select a node`,
	)
	const input = f.host.querySelector<HTMLInputElement>(
		`[aria-label="Search ecology"]`,
	)!
	input.value = `family`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	input.dispatchEvent(
		new KeyboardEvent(`keydown`, { key: `ArrowDown`, bubbles: true }),
	)
	await settle()
	expect(document.activeElement?.getAttribute(`aria-label`)).not.toBe(`family`)
})
