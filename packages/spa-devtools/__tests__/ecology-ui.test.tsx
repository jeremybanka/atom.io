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
			`input[aria-label="Search ecology"]`,
		)!
		input.value = value
		input.dispatchEvent(new Event(`input`, { bubbles: true }))
		await settle()
	}
	return { silo, host, mount, click, select, search }
}

it(`opens/searches/selects/traces/expands passively and evaluates only with Generate`, async () => {
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
	expect(f.host.querySelector(`ecology-editor`)!.textContent).toContain(
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
		f.host.querySelector<HTMLElement>(`ecology-view`)!.dataset[`counts`],
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
	await f.click(`Generate dormant`)
	expect(getter).toHaveBeenCalledTimes(1)
	expect(
		f.host.querySelector(`ecology-editor input`)?.hasAttribute(`readonly`),
	).toBe(true)
	f.host
		.querySelector(`ecology-editor input`)!
		.dispatchEvent(
			new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
		)
	await f.click(`Clear selection`)
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
	const scene = f.host.querySelector(`ecology-scene`)!
	for (const key of [`+`, `-`, `+`]) {
		scene.dispatchEvent(
			new KeyboardEvent(`keydown`, { key, bubbles: true, cancelable: true }),
		)
		await settle()
	}
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
	expect(f.host.querySelector(`ecology-editor`)!.textContent).toContain(
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
	expect(
		f.host.querySelector(
			`ecology-editor-row[data-section="selected"] button[data-graph-id]`,
		)!.textContent,
	).toBe(`count`)
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
	expect(f.host.querySelector(`ecology-editor`)!.textContent).toContain(`Nodes`)
	await f.click(`Clear selection`)
	expect(f.host.textContent).toContain(`Nodes`)
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
		`input[aria-label="Search ecology"]`,
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
	expect(
		f.host.querySelector(
			`ecology-editor-row[data-section="selected"] button[data-graph-id]`,
		),
	).toBeNull()
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
	expect(
		f.host.querySelector(
			`ecology-editor-row[data-section="selected"] button[data-graph-id]`,
		),
	).toBeNull()
	f.host
		.querySelector(`ecology-editor-row:not([hidden]) button[data-graph-id]`)!
		.dispatchEvent(
			new KeyboardEvent(`keydown`, {
				key: `Escape`,
				bubbles: true,
				cancelable: true,
			}),
		)
	await settle()
	expect(document.activeElement).toBe(input)
})

it(`toggles a selected family with Enter from its card, heading, list and graph`, async () => {
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
	expect(f.host.textContent).toContain(`Expand family`)
	for (const selector of [
		`ecology-editor-row[data-section="selected"] button[data-graph-id]`,
		`ecology-editor-row:not([hidden]) button[data-graph-id]`,
		`ecology-scene`,
	]) {
		f.host.querySelector(selector)!.dispatchEvent(
			new KeyboardEvent(`keydown`, {
				key: `Enter`,
				bubbles: true,
				cancelable: true,
			}),
		)
		await settle()
		expect(f.host.textContent).toContain(`Collapse family`)
		await f.click(`Collapse family`)
	}
})

it(`keeps a selected member and its logical focus through repeated family toggles`, async () => {
	const f = setup()
	const getter = vi.fn(() => 1)
	const inputsAtoms = f.silo.atomFamily<number, string>({
		key: `inputs`,
		default: getter,
	})
	const derivedSelectors = f.silo.selectorFamily<number, string>({
		key: `derived`,
		get: () => getter,
	})
	for (const family of [inputsAtoms, derivedSelectors])
		f.silo.store.families.get(family.key)!.create(`one`)
	f.silo.store.selectorGraph.set(
		{
			upstreamSelectorKey: `inputs("one")`,
			downstreamSelectorKey: `derived("one")`,
		},
		{ source: `inputs("one")` },
	)
	f.mount()
	await settle()
	for (const family of [inputsAtoms, derivedSelectors]) {
		for (const scope of [
			`ecology-node-card > button`,
			`ecology-editor-row:not([hidden]) button[data-graph-id]`,
			`ecology-editor-row[data-section="selected"] button[data-graph-id]`,
			`ecology-scene`,
		]) {
			await f.select(`family:${family.key}`)
			await f.click(`Expand family`)
			const id = `state:${family.key}("one")`
			await f.select(id)
			const target = scope.includes(`button`)
				? [...f.host.querySelectorAll<HTMLElement>(scope)].find(
						(button) => button.dataset[`graphId`] === id,
					)!
				: f.host.querySelector<HTMLElement>(scope)!
			target.focus()
			for (let cycle = 0; cycle < 4; cycle++) {
				document.activeElement!.dispatchEvent(
					new KeyboardEvent(`keydown`, {
						key: `Enter`,
						bubbles: true,
						cancelable: true,
					}),
				)
				await settle()
				const visibleId = cycle % 2 ? id : `family:${family.key}`
				expect(
					f.host.querySelector(
						`ecology-editor-row[data-section="selected"] button[data-graph-id]`,
					)!.textContent,
				).toBe(`${family.key}("one")`)
				expect(
					f.host
						.querySelector(`ecology-node-card > button[aria-pressed="true"]`)!
						.getAttribute(`data-graph-id`),
				).toBe(visibleId)
				expect(
					f.host.querySelector<HTMLElement>(`[data-selection-context]`)!.hidden,
				).toBe(true)
				if (scope.includes(`button`)) {
					expect(document.activeElement!.getAttribute(`data-graph-id`)).toBe(
						scope.startsWith(`ecology-editor`) ? id : visibleId,
					)
					expect(
						document.activeElement!.closest(
							scope.startsWith(`ecology-editor`)
								? `ecology-editor`
								: `ecology-node-card`,
						),
					).not.toBeNull()
				} else expect(document.activeElement).toBe(target)
			}
			await f.select(`family:${family.key}`)
			await f.click(`Collapse family`)
		}
	}
	expect(getter).not.toHaveBeenCalled()
})

it(`cleans up hidden, minimized, superseded and disposed jobs and keeps empty flows accessible`, async () => {
	const f = setup()
	f.mount()
	const input = f.host.querySelector<HTMLInputElement>(
		`input[aria-label="Search ecology"]`,
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
		.querySelector(`ecology-view`)!
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
	await f.click(`Generate count`)
	const input = f.host.querySelector<HTMLInputElement>(
		`ecology-editor input[aria-label="count"]`,
	)!
	input.value = `2.`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	await settle()
	expect(input.value).toBe(`2.`)
	expect(f.silo.getState(countAtom)).toBe(2)
	await f.click(`Clear selection`)
	await f.select(`state:count`)
	await f.search(`absent`)
	expect(
		f.host.querySelector(
			`ecology-editor-row[data-section="selected"] button[data-graph-id]`,
		),
	).toBeNull()
	await f.search(``)
	await f.select(`family:items`)
	await f.click(`Expand family`)
	await f.select(`state:${member.key}`)
	f.silo.disposeState(itemsAtoms, `a`)
	await f.click(`Generate ${member.key}`)
	expect(f.host.textContent).toContain(`State was disposed`)
	await f.click(`Clear selection`)
	await f.select(`state:${member.key}`)
	f.host
		.querySelector<HTMLElement>(
			`ecology-node-card > button[data-graph-id][aria-pressed="true"]`,
		)!
		.focus()
	await f.click(`Refresh`)
	expect(f.host.textContent).toContain(`Nodes`)
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
	expect(f.host.querySelector(`ecology-editor`)!.textContent).toContain(
		`(truncated)`,
	)
	expect(
		f.host.querySelector(`ecology-view [data-notice]`)!.textContent,
	).toContain(`full store totals unknown`)
	for (let index = 0; index < 10_001; index++)
		f.silo.store.families.get(manyAtoms.key)!.create(index)
	await f.click(`Refresh`)
	expect(f.host.querySelector(`ecology-editor`)!.textContent).toContain(
		`Selection outside this captured snapshot`,
	)
	await f.select(`family:many`)
	expect(f.host.querySelector(`ecology-editor`)!.textContent).toContain(
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
	expect(f.host.querySelector(`ecology-editor`)!.textContent).toContain(
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
	f.host
		.querySelector<HTMLElement>(
			`ecology-editor-row[data-section="selected"] button[data-graph-id]`,
		)!
		.focus()
	f.silo.store.families.set(membersAtoms.key, definition)
	f.silo.disposeState(membersAtoms, `a`)
	await f.click(`Refresh`)
	expect(document.activeElement?.getAttribute(`aria-label`)).toBe(
		`Search ecology`,
	)
	expect(f.host.textContent).toContain(`Nodes`)
})

it(`clears family selection safely and ignores result navigation while matching`, async () => {
	const f = setup()
	f.silo.atomFamily<number, string>({ key: `family`, default: 0 })
	f.mount()
	await settle()
	await f.select(`family:family`)
	await f.click(`Clear selection`)
	expect(f.host.querySelector(`ecology-editor`)!.textContent).toContain(`Nodes`)
	const input = f.host.querySelector<HTMLInputElement>(
		`input[aria-label="Search ecology"]`,
	)!
	input.value = `family`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	input.dispatchEvent(
		new KeyboardEvent(`keydown`, { key: `ArrowDown`, bubbles: true }),
	)
	await settle()
	expect(document.activeElement?.getAttribute(`aria-label`)).not.toBe(`family`)
})

it(`previews cached primitives and opaque object shapes without evaluating or traversing values`, async () => {
	const f = setup(),
		read = vi.fn(() => {
			throw new Error(`must not inspect`)
		})
	const object = Object.defineProperty({}, `hidden`, {
		enumerable: true,
		get: read,
	})
	const proxy = new Proxy({}, { get: read, getPrototypeOf: read, ownKeys: read })
	for (const [key, value] of [
		[`number`, 42],
		[`text`, `pantry`],
		[`object`, object],
		[`proxy`, proxy],
		[`undefined`, undefined],
	] as const) {
		f.silo.atom<unknown>({ key, default: null })
		f.silo.store.valueMap.set(key, value)
	}
	f.silo.atom<number>({ key: `missing`, default: read })
	f.mount()
	await settle()
	const detail = (key: string) =>
		f.host.querySelector(
			`ecology-node-card:has([data-graph-id="state:${key}"]) small`,
		)!.textContent
	expect(detail(`number`)).toBe(`Atom · 42`)
	expect(detail(`text`)).toBe(`Atom · "pantry"`)
	expect(detail(`undefined`)).toBe(`Atom · undefined`)
	expect(detail(`object`)).toBe(`Atom · {…}`)
	expect(detail(`missing`)).toBe(`Atom · –`)
	expect(
		f.host.querySelector(`ecology-editor input[aria-label="number"]`),
	).not.toBeNull()
	expect(
		f.host.querySelector(`button[aria-label="Generate missing"]`),
	).not.toBeNull()
	expect(read).not.toHaveBeenCalled()
})

it(`partitions colored editor rows by selection and graph paths, and keeps filtered canvas context`, async () => {
	const f = setup()
	for (const key of [`a`, `b`, `side`]) f.silo.atom<number>({ key, default: 1 })
	for (const key of [`selectedEntry`, `t`])
		f.silo.selector<number>({ key, get: () => 2 })
	for (const [dependency, selector] of [
		[`a`, `selectedEntry`],
		[`b`, `selectedEntry`],
		[`selectedEntry`, `t`],
		[`a`, `side`],
	])
		f.silo.store.selectorGraph.set(
			{ upstreamSelectorKey: dependency, downstreamSelectorKey: selector },
			{ source: dependency },
		)
	f.mount()
	await settle()
	expect(
		f.host.querySelectorAll(`ecology-editor h3[data-section-heading]`),
	).toHaveLength(1)
	await f.select(`state:selectedEntry`)
	const rows = (section: string) =>
		[
			...f.host.querySelectorAll<HTMLElement>(
				`ecology-editor-row[data-section="${section}"]:not([hidden])`,
			),
		].map((row) => row.dataset[`rowId`])
	expect(rows(`selected`)).toEqual([`state:selectedEntry`])
	expect(rows(`related`)).toEqual([`state:a`, `state:b`, `state:t`])
	expect(rows(`rest`)).toEqual([`state:side`])
	const row = f.host.querySelector<HTMLElement>(
		`ecology-editor-row[data-row-id="state:a"]`,
	)!
	const card = f.host.querySelector<HTMLElement>(
		`ecology-node-card:has([data-graph-id="state:a"])`,
	)!
	expect(row.style.getPropertyValue(`--ecology-color`)).toBe(
		card.style.getPropertyValue(`--ecology-color`),
	)
	const positions = [...f.host.querySelectorAll(`ecology-node-card`)]
		.map((node) => node.getAttribute(`data-position`))
		.sort()
	await f.search(`selectedEntry`)
	expect(
		f.host.querySelectorAll(`ecology-editor-row:not([hidden])`),
	).toHaveLength(1)
	expect(
		f.host.querySelectorAll(`ecology-node-card[data-collapsed="true"]`),
	).toHaveLength(4)
	expect(
		[...f.host.querySelectorAll(`ecology-node-card`)]
			.map((node) => node.getAttribute(`data-position`))
			.sort(),
	).toEqual(positions)
	await f.search(`does-not-exist`)
	expect(
		f.host.querySelectorAll(`ecology-editor-row:not([hidden])`),
	).toHaveLength(0)
	expect(
		f.host.querySelectorAll(`ecology-node-card[data-collapsed="true"]`),
	).toHaveLength(5)
	await f.search(``)
	expect(
		f.host.querySelectorAll(`ecology-node-card[data-collapsed="true"]`),
	).toHaveLength(0)
})

it(`generates missing state explicitly and reuses nested, writable and readonly cached editors`, async () => {
	const f = setup(),
		get = vi.fn(() => ({ quantity: 2, nested: { enabled: true } })),
		failed = vi.fn(() => {
			throw new Error(`generation failed`)
		})
	const objectAtom = f.silo.atom<unknown>({ key: `object`, default: get })
	f.silo.selector<number>({ key: `readonly`, get: () => 3 })
	f.silo.selector<number>({ key: `failed`, get: failed })
	f.mount()
	await settle()
	await f.select(`state:object`)
	expect(get).not.toHaveBeenCalled()
	await f.click(`Generate object`)
	expect(get).toHaveBeenCalledTimes(1)
	expect(document.activeElement?.getAttribute(`aria-label`)).toBe(
		`Expand object`,
	)
	expect(f.host.querySelector(`button[aria-label="Generate object"]`)).toBeNull()
	await f.click(`Expand object`)
	const input = f.host.querySelector<HTMLInputElement>(
		`ecology-editor input[aria-label="quantity"]`,
	)!
	input.value = `4`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	await settle()
	expect(f.silo.getState(objectAtom)).toMatchObject({ quantity: 4 })
	await f.click(`Expand nested`)
	expect(
		f.host.querySelector(`ecology-editor input[aria-label="enabled"]`),
	).not.toBeNull()
	await f.select(`state:readonly`)
	await f.click(`Generate readonly`)
	expect(document.activeElement?.getAttribute(`aria-label`)).toBe(`readonly`)
	expect(
		f.host
			.querySelector(`ecology-editor input[aria-label="readonly"]`)!
			.hasAttribute(`readonly`),
	).toBe(true)
	await f.select(`state:failed`)
	await f.click(`Generate failed`)
	expect(failed).toHaveBeenCalledTimes(1)
	expect(f.host.textContent).toContain(`generation failed`)
})

it(`progressively admits editor rows without changing the bounded canvas`, async () => {
	const f = setup()
	for (let index = 0; index < 220; index++)
		f.silo.atom<number>({ key: `node${index}`, default: 0 })
	f.mount()
	await settle()
	expect(
		f.host.querySelectorAll(`ecology-editor-row:not([hidden])`),
	).toHaveLength(50)
	expect(
		f.host.querySelectorAll(`ecology-node-card:not([hidden])`),
	).toHaveLength(220)
	await f.click(`Show more nodes`)
	expect(
		f.host.querySelectorAll(`ecology-editor-row:not([hidden])`),
	).toHaveLength(100)
	for (let more = 0; more < 3; more++) await f.click(`Show more nodes`)
	expect(
		f.host.querySelectorAll(`ecology-editor-row:not([hidden])`),
	).toHaveLength(220)
	expect(
		[...f.host.querySelectorAll(`button`)].find(
			(node) => node.textContent === `Show more nodes`,
		),
	).toBeUndefined()
})

it(`focuses generated controls even when the new value leaves the filter, and recovers if the state disappears`, async () => {
	const f = setup()
	f.silo.atom<undefined>({ key: `emptyValue`, default: () => undefined })
	f.silo.selector<undefined>({ key: `noValue`, get: () => undefined })
	const ephemeralAtoms = f.silo.atomFamily<number, string>({
		key: `ephemeral`,
		default: (key) => {
			queueMicrotask(() => {
				f.silo.disposeState(ephemeralAtoms, key)
			})
			return 1
		},
	})
	f.silo.store.families.get(ephemeralAtoms.key)!.create(`one`)
	f.mount()
	await settle()
	await f.search(`not cached`)
	await f.click(`Generate emptyValue`)
	expect(document.activeElement!.tagName).toBe(`SELECT`)
	expect(
		f.host.querySelector(
			`ecology-editor-row[data-row-id="state:emptyValue"] [data-pinned]`,
		),
	).not.toBeNull()
	await f.search(``)
	await f.click(`Generate noValue`)
	expect((document.activeElement as HTMLElement).dataset[`graphId`]).toBe(
		`state:noValue`,
	)
	await f.click(`Expand ephemeral`)
	await f.click(`Generate ephemeral("one")`)
	expect(f.host.textContent).toContain(`State was disposed`)
	expect(document.activeElement?.getAttribute(`aria-label`)).toBe(
		`Search ecology`,
	)
})
