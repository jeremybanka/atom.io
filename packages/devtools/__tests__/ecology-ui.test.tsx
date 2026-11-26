import { render } from "@atom.io/spa"
import { jsx } from "@atom.io/spa/jsx-runtime"
import { Silo } from "atom.io"
import type * as Motion from "motion"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { createCardFeedback } from "../src/ecology-card-feedback.ts"
import { createEcologyController } from "../src/ecology-controller.ts"
import { Ecology, mountEcology } from "../src/ecology-entry.ts"
import { createGraphContext } from "../src/ecology-graph.ts"
import { mountAtomIODevtools } from "../src/mount.ts"

vi.mock(`motion`, async (actual) => {
	const motion = await actual<typeof Motion>()
	return { ...motion, animate: vi.fn(motion.animate) }
})

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

it(`mounts Ecology in a plain host and reports errors within that explorer`, async () => {
	const f = setup()
	const sibling = document.createElement(`button`)
	f.host.append(sibling)
	const failing = vi.fn(() => {
		throw new Error(`generation failed`)
	})
	f.silo.selector<number>({ key: `failing`, get: failing })
	dispose = mountEcology(f.host, { store: f.silo.store }).dispose
	await settle()
	expect(f.host.querySelector(`ecology-scene canvas`)).not.toBeNull()
	expect(f.host.querySelector(`debugger-panel`)).toBeNull()
	expect(failing).not.toHaveBeenCalled()
	await f.click(`Generate failing`)
	expect(failing).toHaveBeenCalledTimes(1)
	expect(f.host.querySelector(`[role="alert"]`)?.textContent).toBe(
		`generation failed`,
	)
	dispose()
	dispose()
	expect([...f.host.children]).toEqual([sibling])
	expect(vi.getTimerCount()).toBe(0)
})

it(`uses the supplied store from a SPA root that uses a different store`, async () => {
	const f = setup()
	const parent = new Silo({
		name: `ecology-parent`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	parent.atom<number>({ key: `parent-only`, default: 0 })
	const countAtom = f.silo.atom<number>({ key: `count`, default: 1 })
	f.silo.getState(countAtom)
	const root = render(() => jsx(Ecology, { store: f.silo.store }), f.host, {
		store: parent.store,
	})
	dispose = root.dispose
	await settle()
	expect(f.host.querySelector(`[data-graph-id="state:parent-only"]`)).toBeNull()
	const input = f.host.querySelector<HTMLInputElement>(
		`ecology-editor input[aria-label="count"]`,
	)!
	input.value = `4`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	await settle()
	expect(f.silo.getState(countAtom)).toBe(4)
	dispose()
	expect(f.host.childNodes).toHaveLength(0)
	expect([...f.silo.store.atoms.keys()]).toEqual([`count`])
})

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
	for (const [id, kind, label] of [
		[`state:lazy`, `atom`, `Atom`],
		[`state:dormant`, `selector`, `Selector`],
		[`family:items`, `atom-family`, `Atom Family`],
		[`family:derived`, `selector-family`, `Selector Family`],
	]) {
		const detail = f.host.querySelector(
			`ecology-node-card > [data-graph-id="${id}"] > small[data-uncached]`,
		)
		const row = f.host.querySelector(`ecology-editor-row[data-row-id="${id}"]`)
		expect(detail?.textContent).toMatch(new RegExp(`^${label} · `))
		for (const icon of [detail?.firstElementChild, row?.firstElementChild]) {
			expect(icon?.getAttribute(`data-primitive`)).toBe(kind)
			const svg = icon?.querySelector(`svg`)
			expect(svg?.querySelector(`rect`)?.namespaceURI).toBe(
				`http://www.w3.org/2000/svg`,
			)
			expect(svg?.getAttribute(`fill`)).toBe(`var(--ecology-color)`)
			expect(svg?.getAttribute(`aria-hidden`)).toBe(`true`)
		}
	}
	await f.search(`dormant`)
	await f.select(`state:dormant`, `Enter`)
	await f.search(``)
	await f.select(`state:sum`)
	await f.select(`family:items`)
	await f.click(`Expand items`)
	expect(
		f.host.querySelector<HTMLElement>(`ecology-view`)!.dataset[`counts`],
	).toContain(`3 families / 1 members`)
	await f.click(`Collapse items`)
	await f.select(`family:zero`, ` `)
	expect(f.host.textContent).toContain(`0 members`)
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

it(`searches and expands timeline families independently of state families with the same key`, async () => {
	const f = setup()
	const draftAtoms = f.silo.atomFamily<number, string>({
		key: `draft`,
		default: 0,
	})
	const state = f.silo.findState(draftAtoms, `first`)
	f.silo.getState(state)
	const run = vi.fn()
	f.silo.transaction({ key: state.key, do: run })
	dispose = mountEcology(f.host, { store: f.silo.store }).dispose
	await settle()

	const row = (id: string) => f.host.querySelector(`[data-row-id='${id}']`)
	const card = (id: string) =>
		f.host.querySelector(`ecology-node-card > button[data-graph-id='${id}']`)
	expect(card(`transaction:${state.key}`)?.textContent).toContain(`Transaction`)
	expect(
		row(`transaction:${state.key}`)?.firstElementChild?.getAttribute(
			`data-primitive`,
		),
	).toBe(`transaction`)

	const draftTimelines = f.silo.timelineFamily<string>({
		key: `draft`,
		scope: [],
	})
	await settle()
	expect(card(`timeline_family:${draftTimelines.key}`)?.textContent).toContain(
		`Timeline Family · 0 members`,
	)
	expect(
		row(
			`timeline_family:${draftTimelines.key}`,
		)?.firstElementChild?.getAttribute(`data-primitive`),
	).toBe(`timeline-family`)
	const timeline = f.silo.findTimeline(draftTimelines, `first`)
	await settle()
	expect(timeline.key).toBe(state.key)
	expect(card(`timeline_family:${draftTimelines.key}`)?.textContent).toContain(
		`1 members`,
	)
	expect(row(`timeline:${timeline.key}`)).toBeNull()
	await f.search(`timeline`)
	f.host
		.querySelector<HTMLButtonElement>(
			`[data-result-id='timeline:${timeline.key}']`,
		)!
		.click()
	await settle()
	expect(card(`timeline:${timeline.key}`)?.textContent).toContain(
		`Timeline · 0 of 0 events applied`,
	)
	expect(
		row(`timeline:${timeline.key}`)?.firstElementChild?.getAttribute(
			`data-primitive`,
		),
	).toBe(`timeline`)
	await f.search(``)
	expect(
		row(`family:${draftAtoms.key}`)
			?.querySelector(`button[data-action="expand"]`)
			?.getAttribute(`aria-expanded`),
	).toBe(`false`)
	expect(row(`state:${state.key}`)).toBeNull()
	expect(run).not.toHaveBeenCalled()
})

it(`opens recorded transaction outcomes and timeline controls in the standalone editor`, async () => {
	const f = setup()
	const countAtom = f.silo.atom<number>({ key: `count`, default: 0 })
	f.silo.getState(countAtom)
	f.silo.timeline({ key: `count`, scope: [countAtom] })
	const saveTransaction = f.silo.transaction({
		key: `save`,
		do: ({ set }, value: number) => {
			set(countAtom, value)
			return value
		},
	})
	dispose = mountEcology(f.host, { store: f.silo.store }).dispose
	await settle()
	await f.click(`Expand transaction save`)
	expect(f.host.querySelector(`transaction-outcomes`)?.textContent).toBe(
		`No recorded outcomes`,
	)
	await f.click(`Collapse transaction save`)
	f.silo.runTransaction(saveTransaction)(2)
	f.silo.runTransaction(saveTransaction)(4)
	await settle()

	const editor = f.host.querySelector(`ecology-editor`)!
	expect(
		editor.querySelector(`transaction-outcomes, timeline-history`),
	).toBeNull()
	await f.select(`transaction:save`, `Enter`)
	const outcomes = editor.querySelector(`transaction-outcomes`)!
	expect(outcomes.textContent).toBe(`Outcome 11 writeOutcome 21 write`)
	await f.click(`Expand outcome 2`)
	const second = outcomes.querySelectorAll(`:scope > event-view`)[1]
	expect(second.querySelector(`p[data-compact-write]`)?.textContent).toBe(
		`count24`,
	)
	expect(second.querySelector(`p[data-outcome-metadata]`)?.textContent).toBe(
		`Args[4]Result4`,
	)
	const scene = f.host.querySelector(`ecology-scene`)!
	const axis = (control: Element) =>
		control
			.closest(`ecology-node-card`)!
			.getAttribute(`data-position`)!
			.split(`,`)
			.map(Number)
	const node = (id: string) =>
		scene.querySelector(`button[data-graph-id="${id}"]`)!
	const outcomeCards = [
		...scene.querySelectorAll<HTMLButtonElement>(
			`[data-history="outcome"] > button`,
		),
	]
	const [transactionX, transactionY, transactionZ] = axis(
		node(`transaction:save`),
	)
	expect(
		outcomeCards.map((card) => card.querySelector(`strong`)?.textContent),
	).toEqual([`Outcome 1`, `Outcome 2`])
	expect(axis(outcomeCards[0])).toEqual([
		transactionX,
		expect.any(Number),
		transactionZ,
	])
	expect(transactionY).toBeGreaterThan(axis(outcomeCards[0])[1])
	expect(axis(outcomeCards[0])[1]).toBeGreaterThan(axis(outcomeCards[1])[1])
	outcomeCards[0].focus()
	await f.select(outcomeCards[0].getAttribute(`data-graph-id`)!)
	expect(document.activeElement?.closest(`transaction-outcomes`)).not.toBeNull()
	await f.select(`timeline:count`, `Enter`)
	const heading = editor.querySelector(
		`ecology-operation-history > node-heading:has(timeline-travel)`,
	)!
	expect(heading.lastElementChild?.localName).toBe(`timeline-travel`)
	const disabledRedo = editor.querySelector<HTMLButtonElement>(
		`timeline-travel button:disabled`,
	)!
	expect(disabledRedo.getAttribute(`aria-label`)).toBe(`redo`)
	expect(disabledRedo.querySelector(`[data-editor-icon="redo"]`)).not.toBeNull()
	expect(outcomes.querySelector(`[data-editor-icon="arrow"]`)).not.toBeNull()
	expect(
		outcomes.querySelector(`event-heading button [data-editor-icon="collapse"]`),
	).not.toBeNull()
	expect(scene.getAttribute(`data-history-connections`)).toBe(`2`)
	expect(
		editor.querySelector(`timeline-history [data-cursor]`)?.textContent,
	).toBe(`Current position`)
	await f.click(`undo`)
	expect(f.silo.getState(countAtom)).toBe(2)
	const past = scene.querySelector(`[data-history="past"] > button`)!
	const future = scene.querySelector(`[data-history="future"] > button`)!
	const [timelineX, timelineY, timelineZ] = axis(node(`timeline:count`))
	expect(axis(past)).toEqual([timelineX, expect.any(Number), timelineZ])
	expect(axis(future)).toEqual([timelineX, expect.any(Number), timelineZ])
	expect(axis(past)[1]).toBeGreaterThan(timelineY)
	expect(axis(future)[1]).toBeLessThan(timelineY)
	const futureId = future.getAttribute(`data-history-event`)
	await f.select(future.getAttribute(`data-graph-id`)!, `Enter`)
	expect(
		document.activeElement
			?.closest(`[data-history-event]`)
			?.getAttribute(`data-history-event`),
	).toBe(futureId)
	expect(
		editor.querySelector(`timeline-history [data-cursor]`)?.nextElementSibling
			?.localName,
	).toBe(`event-view`)
	await f.click(`redo`)
	expect(f.silo.getState(countAtom)).toBe(4)
	outcomeCards[0].focus()
	await f.select(`transaction:save`, `Enter`)
	expect(document.activeElement).toBe(node(`transaction:save`))
	await f.select(`timeline:count`, `Enter`)
	node(`timeline:count`).dispatchEvent(
		new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true, repeat: true }),
	)
	await settle()
	expect(
		editor.querySelector(`transaction-outcomes, timeline-history`),
	).toBeNull()
	expect(scene.getAttribute(`data-history-connections`)).toBe(`0`)
})

it(`synchronizes individual history entries between the graph and the editor`, async () => {
	const f = setup()
	const countAtom = f.silo.atom<number>({ key: `count`, default: 0 })
	f.silo.getState(countAtom)
	const countTimeline = f.silo.timeline({ key: `count`, scope: [countAtom] })
	const saveTransaction = f.silo.transaction({
		key: `save`,
		do: ({ set }, value: number) => {
			set(countAtom, value)
		},
	})
	f.mount()
	await settle()
	const run = f.silo.runTransaction(saveTransaction)
	run(1)
	run(2)
	await settle()
	await f.click(`Expand transaction save`)
	await f.click(`Expand timeline count`)
	const view = f.host.querySelector<HTMLElement>(`ecology-view`)!
	const events = [
		...view.querySelectorAll<HTMLElement>(`event-view[data-history-graph-id]`),
	]
	const [outcome, other, , event] = events
	const pair = (entry: HTMLElement) => {
		const id = entry.dataset[`historyGraphId`]!
		return {
			id,
			editor: entry.querySelector<HTMLButtonElement>(
				`event-heading > button[data-graph-id]`,
			)!,
			map: [
				...view.querySelectorAll<HTMLButtonElement>(
					`ecology-node-card > button`,
				),
			].find((button) => button.dataset[`graphId`] === id)!,
		}
	}
	const selected = (entry: HTMLElement) =>
		[pair(entry).editor, pair(entry).map].map((node) =>
			node.getAttribute(`aria-pressed`),
		)
	const hover = async (node: Element, type = `pointerover`) => {
		node.dispatchEvent(
			new PointerEvent(type, { bubbles: true, pointerType: `mouse` }),
		)
		await settle()
	}
	const hovered = () => [...view.querySelectorAll(`[data-hovered="true"]`)]
	await f.click(`Expand outcome 1`)
	const jobs = view.dataset[`jobs`]
	await hover(outcome.querySelector(`p[data-compact-write] ins`)!)
	expect(hovered()).toEqual([pair(outcome).map.parentElement, outcome])
	expect(view.dataset[`jobs`]).toBe(jobs)
	await hover(pair(event).map)
	expect(hovered()).toEqual([pair(event).map.parentElement, event])
	await hover(pair(event).map, `pointercancel`)
	expect(hovered()).toEqual([])

	const outcomePair = pair(outcome)
	outcomePair.editor.focus()
	outcomePair.editor.dispatchEvent(
		new KeyboardEvent(`keydown`, { key: ` `, bubbles: true, cancelable: true }),
	)
	await settle()
	expect(selected(outcome)).toEqual([`true`, `true`])
	expect(selected(other)).toEqual([`false`, `false`])
	expect(document.activeElement).toBe(outcomePair.editor)
	expect(
		view
			.querySelector(`[data-graph-id="transaction:save"]`)
			?.getAttribute(`aria-pressed`),
	).toBe(`false`)
	expect(
		outcome.closest(`ecology-editor-row`)?.getAttribute(`data-selection-anchor`),
	).toBe(`false`)
	const disclosure = outcome.querySelector<HTMLButtonElement>(
		`event-heading > button[aria-expanded]`,
	)!
	disclosure.click()
	await settle()
	expect(disclosure.getAttribute(`aria-expanded`)).toBe(`false`)
	expect(selected(outcome)).toEqual([`true`, `true`])

	const eventPair = pair(event)
	await f.select(eventPair.id)
	expect(selected(event)).toEqual([`true`, `true`])
	expect(selected(outcome)).toEqual([`false`, `false`])
	expect(document.activeElement).toBe(eventPair.editor)
	await f.click(`undo`)
	expect(pair(event).map.parentElement?.getAttribute(`data-history`)).toBe(
		`future`,
	)
	expect(selected(event)).toEqual([`true`, `true`])
	const owner = () =>
		view.querySelector(
			`ecology-node-card > button[data-graph-id="timeline:count"]`,
		)
	await f.click(`Collapse timeline count`)
	expect(owner()?.getAttribute(`aria-pressed`)).toBe(`true`)
	expect(document.activeElement?.getAttribute(`data-graph-id`)).toBe(
		`timeline:count`,
	)
	await f.select(`timeline:count`, `Enter`)
	const reopened = [
		...view.querySelectorAll<HTMLElement>(`event-view[data-history-graph-id]`),
	].find((entry) => entry.dataset[`historyGraphId`] === eventPair.id)!
	expect(selected(reopened)).toEqual([`true`, `true`])
	f.silo.clearTimeline(countTimeline)
	await settle()
	expect(owner()?.getAttribute(`aria-pressed`)).toBe(`true`)
	await f.click(`Clear selection`)
	expect(view.querySelector(`button[aria-pressed="true"]`)).toBeNull()
})

it(`updates a timeline cursor without recapturing the graph`, async () => {
	const f = setup()
	const countAtom = f.silo.atom<number>({ key: `count`, default: 0 })
	f.silo.getState(countAtom)
	f.silo.timeline({ key: `count`, scope: [countAtom] })
	f.mount()
	await settle()
	const view = f.host.querySelector<HTMLElement>(`ecology-view`)!
	const jobs = view.dataset[`jobs`]
	const scan = vi.spyOn(f.silo.store.timelines, `values`)
	f.silo.setState(countAtom, 1)
	await settle()
	expect(
		f.host.querySelector(
			`ecology-node-card button[data-graph-id="timeline:count"]`,
		)?.textContent,
	).toContain(`1 of 1 event applied`)
	expect(
		f.host.querySelector(
			`ecology-editor-row[data-row-id="timeline:count"] node-heading small`,
		)?.textContent,
	).toBe(`1 of 1 event applied`)
	expect(Number(view.dataset[`jobs`])).toBeGreaterThan(Number(jobs))
	expect(scan).not.toHaveBeenCalled()
})

it(`retains outcomes across a debugger remount and a separate Ecology instance`, async () => {
	const f = setup()
	const saveTransaction = f.silo.transaction({
		key: `save`,
		do: (_, value: number) => value,
	})
	f.mount()
	f.silo.runTransaction(saveTransaction)(5)
	await settle()
	dispose()
	f.silo.runTransaction(saveTransaction)(6)
	dispose = mountEcology(f.host, { store: f.silo.store }).dispose
	await settle()
	await f.click(`Expand transaction save`)
	await f.click(`Expand outcome 1`)
	await f.click(`Expand outcome 2`)
	const outcomes = f.host.querySelector(`transaction-outcomes`)?.textContent
	expect(outcomes).toContain(`Result5`)
	expect(outcomes).toContain(`Result6`)
})

it(`updates and flashes cards from the root cache without evaluating dormant state`, async () => {
	const f = setup()
	const countAtom = f.silo.atom<number>({ key: `count`, default: () => 2 })
	const doubleSelector = f.silo.selector<number>({
		key: `double`,
		get: ({ get }) => get(countAtom) * 2,
	})
	const sleeping = vi.fn(() => 0)
	f.silo.selector<number>({ key: `sleeping`, get: sleeping })
	let resolve!: (value: number) => void
	const request = new Promise<number>((done) => {
		resolve = done
	})
	const quoteSelector = f.silo.selector<Promise<number>>({
		key: `quote`,
		get: () => request,
	})
	f.mount()
	await settle()
	const card = (key: string) =>
		f.host.querySelector<HTMLButtonElement>(
			`ecology-node-card button[data-graph-id="state:${key}"]`,
		)!
	const editor = (key: string) =>
		f.host.querySelector<HTMLInputElement>(
			`ecology-editor [data-testid="state-value-${key}"] input`,
		)
	expect(card(`double`).textContent).toContain(`–`)
	expect(editor(`double`)).toBeNull()
	expect(
		f.silo.store.readonlySelectors.get(`double`)!.subject.subscribers.size,
	).toBe(0)
	f.silo.getState(doubleSelector)
	const pendingQuote = f.silo.getState(quoteSelector)
	await settle()
	expect(card(`count`).textContent).toContain(`Atom · 2`)
	expect(card(`double`).textContent).toContain(`Selector · 4`)
	expect(editor(`double`)?.value).toBe(`4`)
	expect(
		f.host.querySelector<HTMLElement>(`ecology-view`)!.dataset[`counts`],
	).toContain(`1 of 1 captured edges`)
	resolve(17)
	await pendingQuote
	await settle()
	expect(card(`quote`).textContent).toContain(`Selector · 17`)
	expect(editor(`quote`)?.value).toBe(`17`)

	const media = window.matchMedia(`(prefers-reduced-motion: reduce)`)
	Object.defineProperty(media, `matches`, { value: false, configurable: true })
	vi.mocked(window.matchMedia).mockReturnValue(media)
	// Mount a new scene with motion enabled, then observe its retained button.
	await f.click(`atoms`)
	await f.click(`ecology`)
	const atomCard = card(`count`)
	const animate = vi.fn(() => ({ cancel: vi.fn() }))
	Object.defineProperty(atomCard, `animate`, { value: animate })
	const graph = f.host.querySelector<HTMLElement>(`ecology-view`)!
	const jobs = graph.dataset[`jobs`]
	f.silo.setState(countAtom, 3)
	f.silo.getState(doubleSelector)
	await settle()
	expect(card(`count`)).toBe(atomCard)
	expect(atomCard.textContent).toContain(`Atom · 3`)
	expect(card(`double`).textContent).toContain(`Selector · 6`)
	expect(editor(`count`)?.value).toBe(`3`)
	expect(editor(`double`)?.value).toBe(`6`)
	expect(graph.dataset[`jobs`]).toBe(jobs)
	expect(animate).toHaveBeenCalledTimes(1)
	Object.defineProperty(media, `matches`, { value: true })
	f.silo.setState(countAtom, 4)
	await settle()
	expect(animate).toHaveBeenCalledTimes(1)
	expect(card(`double`).textContent).toContain(`–`)
	expect(editor(`double`)).toBeNull()
	expect(sleeping).not.toHaveBeenCalled()
	expect(
		f.silo.store.readonlySelectors.get(`double`)!.subject.subscribers.size,
	).toBe(0)
})

it(`links whole-row and card hover without evaluating state, rebuilding the graph, changing selection or sticking on touch`, async () => {
	const f = setup(),
		lazy = vi.fn(() => 1)
	const countAtom = f.silo.atom<number>({ key: `count`, default: 2 })
	f.silo.getState(countAtom)
	f.silo.atom<number>({ key: `other`, default: lazy })
	const itemsAtoms = f.silo.atomFamily<number, string>({
		key: `items`,
		default: lazy,
	})
	f.silo.store.families.get(itemsAtoms.key)!.create(`a`)
	const before = [...f.silo.store.valueMap]
	f.mount()
	await settle()
	await f.select(`state:other`)
	const pair = (id: string) => ({
		row: [...f.host.querySelectorAll<HTMLElement>(`ecology-editor-row`)].find(
			(node) => node.dataset[`rowId`] === id,
		)!,
		card: [...f.host.querySelectorAll<HTMLElement>(`ecology-node-card`)].find(
			(node) =>
				node.querySelector<HTMLElement>(`button`)!.dataset[`graphId`] === id,
		)!,
	})
	const pointer = async (
		target: Element,
		type: string,
		relatedTarget: EventTarget | null = null,
		pointerType = `mouse`,
	) => {
		target.dispatchEvent(
			new PointerEvent(type, { bubbles: true, relatedTarget, pointerType }),
		)
		await settle()
	}
	const active = (id?: string) => {
		const nodes = [...f.host.querySelectorAll(`[data-hovered="true"]`)]
		expect(nodes).toEqual(
			id ? expect.arrayContaining(Object.values(pair(id))) : [],
		)
		expect(nodes).toHaveLength(id ? 2 : 0)
	}
	const cached = pair(`state:count`),
		input = cached.row.querySelector(`input`)!,
		name = cached.row.querySelector(`[data-graph-id]`)!,
		button = cached.card.querySelector(`button`)!
	const jobs = f.host.querySelector<HTMLElement>(`ecology-view`)!.dataset[`jobs`]
	await pointer(input, `pointerover`)
	active(`state:count`)
	await pointer(input, `pointerout`, name)
	await pointer(name, `pointerover`, input)
	active(`state:count`)
	await pointer(name, `pointerout`, button)
	await pointer(button, `pointerover`, name)
	active(`state:count`)
	expect(cached.row.querySelector(`input`)).toBe(input)
	expect(
		f.host.querySelector<HTMLElement>(`ecology-view`)!.dataset[`jobs`],
	).toBe(jobs)
	expect(
		pair(`state:other`)
			.card.querySelector(`button`)!
			.getAttribute(`aria-pressed`),
	).toBe(`true`)
	await pointer(
		pair(`state:other`).row.querySelector(
			`button[aria-label="Generate other"]`,
		)!,
		`pointerover`,
	)
	active(`state:other`)
	const outside = document.createElement(`button`)
	outside.dataset[`graphId`] = `state:count`
	document.body.append(outside)
	await pointer(pair(`state:other`).row, `pointerout`, outside)
	active()
	await pointer(f.host.querySelector(`ecology-scene`)!, `pointerover`)
	active()
	await pointer(pair(`family:items`).row.querySelector(`button`)!, `pointerover`)
	active(`family:items`)
	await f.click(`Expand items`)
	const member = pair(`state:items("a")`)
	await pointer(member.card.querySelector(`button`)!, `pointerover`)
	active(`state:items("a")`)
	await pointer(member.card, `pointercancel`)
	active()
	await pointer(button, `pointerover`)
	await pointer(member.row, `pointerover`, null, `touch`)
	active()
	await pointer(button, `pointerover`)
	await pointer(button, `pointerout`)
	active()
	expect(lazy).not.toHaveBeenCalled()
	expect(
		[...f.silo.store.valueMap].filter(([key]) => !key.startsWith(`🔍 `)),
	).toEqual(before)
})

it(`retains selection/pan/expansion across snapshots and navigation; geometry-only events do not relayout`, async () => {
	const f = setup()
	const countAtom = f.silo.atom<unknown>({ key: `count`, default: 1 })
	f.silo.getState(countAtom)
	f.mount()
	await settle()
	const scene = f.host.querySelector(`ecology-scene`)!
	const startingPose = scene.getAttribute(`data-camera`)!.split(`,`).map(Number)
	await f.select(`state:count`)
	for (const key of [`+`, `-`, `+`]) {
		scene.dispatchEvent(
			new KeyboardEvent(`keydown`, { key, bubbles: true, cancelable: true }),
		)
		await settle()
	}
	const transform = f.host
		.querySelector(`ecology-scene`)!
		.getAttribute(`data-camera`)
	expect(transform!.split(`,`).map(Number)).not.toEqual(
		startingPose.map((value) => expect.closeTo(value, 10)),
	)
	const position = f.host
		.querySelector(`ecology-node-card`)!
		.getAttribute(`data-position`)
	f.silo.setState(countAtom, `changed`)
	await settle()
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
	expect(
		f.host.querySelector(`ecology-editor input[aria-label="count"]`),
	).not.toBeNull()
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
	await f.click(`Reset view`)
	const resetScene = f.host.querySelector(`ecology-scene`)!
	expect(resetScene.getAttribute(`data-camera`)!.split(`,`).map(Number)).toEqual(
		startingPose.map((value) => expect.closeTo(value, 10)),
	)
	expect(
		f.host.querySelector(`[data-section="selected"] button[data-graph-id]`),
	).toHaveProperty(`textContent`, `count`)
	f.host.querySelector(`ecology-view`)!.dispatchEvent(
		new KeyboardEvent(`keydown`, {
			key: `Escape`,
			bubbles: true,
			cancelable: true,
		}),
	)
	await settle()
	expect(f.host.querySelector(`ecology-editor`)!.textContent).toContain(`Nodes`)
	expect(f.host.querySelector(`[data-action="clear"]:not([inert])`)).toBeNull()
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

it(`stages viewport actions together, cancels stale exits, and restores focus after clearing`, async () => {
	const f = setup()
	f.silo.atom<number>({ key: `count`, default: 0 })
	f.silo.atomFamily<number, string>({ key: `items`, default: 0 })
	const media = window.matchMedia(`(prefers-reduced-motion: reduce)`)
	Object.defineProperty(media, `matches`, { value: false })
	vi.mocked(window.matchMedia).mockReturnValue(media)
	const motion = await import(`motion`)
	const animation = vi.mocked(motion.animate)
	const animate = animation.getMockImplementation()!
	const animations: {
		button: HTMLButtonElement
		stop: ReturnType<typeof vi.fn>
		finish(): void
	}[] = []
	await animation.withImplementation(
		(...args) => {
			const button = args[0]
			if (
				!(button instanceof HTMLButtonElement) ||
				!button.closest(`ecology-map-actions`)
			)
				return Reflect.apply(animate, undefined, args)
			const stop = vi.fn()
			const done = Promise.withResolvers<void>()
			animations.push({ button, stop, finish: done.resolve })
			return {
				stop,
				then: done.promise.then.bind(done.promise),
			} as unknown as ReturnType<typeof animate>
		},
		async () => {
			f.mount()
			await settle()
			const view = f.host.querySelector(`ecology-view`)!
			const scene = view.querySelector(`ecology-scene`)
			const [expand, clear] = view.querySelectorAll<HTMLButtonElement>(
				`ecology-map-actions > button`,
			)
			const actionAnimation = (button: HTMLButtonElement) =>
				animation.mock.calls.findLast(([target]) => target === button)!
			await f.select(`family:items`)
			expect(animations.map(({ button }) => button)).toEqual([expand, clear])
			expect(actionAnimation(clear)[1]).toEqual({
				z: [-52, 0],
				rotateX: [16, 0],
				rotateY: [58, 0],
				opacity: [0, 1],
			})
			expect(actionAnimation(clear)[2]).toMatchObject({
				delay: 0.02,
				type: `tween`,
				ease: [0.1, 0.9, 0.2, 1],
			})
			expect(actionAnimation(expand)[2]).toMatchObject({ delay: 0 })
			expand.focus()
			await f.click(`Expand family`)
			expect(document.activeElement).toBe(expand)

			clear.focus()
			await f.click(`Clear selection`)
			expect(document.activeElement).toBe(scene)
			expect(actionAnimation(clear)[1]).toEqual({
				z: 70,
				rotateX: -18,
				rotateY: -52,
				opacity: 0,
			})
			expect(actionAnimation(clear)[2]).toMatchObject({
				delay: 0.02,
				type: `tween`,
				ease: [0.7, 0, 1, 0.5],
			})
			const [expandExit, clearExit] = animations.slice(-2)
			expandExit.finish()
			await settle()
			expect(expand.hidden).toBe(true)
			expect(clear.hidden).toBe(false)
			view.querySelector<HTMLElement>(`ecology-body`)!.style.display = `flex`
			await f.select(`family:items`)
			expect(actionAnimation(expand)[1]).toEqual({
				z: [-52, 0],
				rotateX: [62, 0],
				rotateY: [12, 0],
				opacity: [0, 1],
			})
			expect(actionAnimation(clear)[2]).toMatchObject({ delay: 0.02 })
			expect(clearExit.stop).toHaveBeenCalledOnce()
			clearExit.finish()
			await settle()
			expect(clear.hidden).toBe(false)

			const clearEntrance = animations.at(-1)!
			await f.select(`state:count`)
			expect(clearEntrance.stop).not.toHaveBeenCalled()
			expect(actionAnimation(expand)[1]).toEqual({
				z: 70,
				rotateX: -52,
				rotateY: -10,
				opacity: 0,
			})
			const query = view.querySelector.bind(view)
			using sceneLookup = vi
				.spyOn(view, `querySelector`)
				.mockImplementation((selector) =>
					selector === `ecology-scene` ? null : query(selector),
				)
			clear.focus()
			await f.click(`Clear selection`)
			expect(sceneLookup).toHaveBeenCalledWith(`ecology-scene`)
			expect(document.activeElement?.getAttribute(`aria-label`)).toBe(
				`Search ecology`,
			)
		},
	)
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
	expect(f.host.querySelector(`[aria-label="Expand family"]`)).not.toBeNull()
	await f.select(`family:family`, `Enter`)
	expect(f.host.querySelector(`[aria-label="Collapse family"]`)).not.toBeNull()
	await f.select(`family:family`, `Enter`)
	expect(f.host.querySelector(`[aria-label="Expand family"]`)).not.toBeNull()
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
		expect(f.host.querySelector(`[aria-label="Collapse family"]`)).not.toBeNull()
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
			await f.click(`Expand ${family.key}`)
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
				).toBe(`"one"`)
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
			await f.click(`Collapse ${family.key}`)
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
	await f.click(`Reset view`)
	expect(f.host.querySelector(`[data-action="clear"]:not([inert])`)).toBeNull()
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

it(`defers a hidden controller and suspends live updates before the visibility observer runs`, async () => {
	const f = setup()
	const countAtom = f.silo.atom<number>({ key: `count`, default: 0 })
	f.silo.getState(countAtom)
	f.mount()
	await settle()
	const panel = document.createElement(`main`)
	const view = f.host
		.querySelector(`ecology-view`)!
		.cloneNode(true) as HTMLElement
	panel.hidden = true
	panel.append(view)
	const update = vi.fn()
	const controller = createEcologyController(
		view,
		panel,
		f.silo.store,
		createGraphContext(),
		update,
		`hidden-controller`,
	)
	try {
		await settle()
		expect(update).not.toHaveBeenCalled()
		expect(
			controller.viewOutcome(`transaction:missing`, `history:missing`),
		).toBe(false)
		panel.hidden = false
		await settle()
		expect(update).toHaveBeenCalledWith({ busy: true })
		update.mockClear()

		f.silo.setState(countAtom, 1)
		panel.hidden = true
		await settle()
		expect(update).not.toHaveBeenCalled()

		panel.hidden = false
		await settle()
		update.mockClear()
		f.silo.setState(countAtom, 2)
		await Promise.resolve()
		panel.hidden = true
		vi.advanceTimersByTime(1)
		await settle()
		expect(update).not.toHaveBeenCalled()
	} finally {
		controller.dispose()
	}
})

it(`paints the initial snapshot when the search is invalid and picks up newly registered families`, async () => {
	const f = setup()
	f.silo.atom<number>({ key: `first`, default: 1 })
	f.mount()
	await f.search(`x`.repeat(257))
	expect(f.host.textContent).toContain(`Use at most 256 characters`)
	expect(f.host.querySelector(`[data-graph-id="state:first"]`)).not.toBeNull()
	await f.search(``)
	f.silo.atomFamily<number, string>({ key: `newFamily`, default: 0 })
	await settle()
	expect(
		f.host.querySelector(`[data-graph-id="family:newFamily"]`),
	).not.toBeNull()
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
	await f.click(`Expand items`)
	await f.select(`state:${member.key}`)
	f.host
		.querySelector<HTMLElement>(
			`ecology-node-card > button[aria-pressed="true"]`,
		)!
		.focus()
	f.silo.disposeState(itemsAtoms, `a`)
	await settle()
	expect(
		f.host.querySelector(`[data-graph-id='state:${member.key}']`),
	).toBeNull()
	expect(f.host.textContent).toContain(`0 members`)
	expect(document.activeElement?.getAttribute(`aria-label`)).toBe(
		`Search ecology`,
	)
})

it(`reports capture limits and ignores activity outside the retained graph`, async () => {
	const f = setup()
	const family = { key: `many`, default: 0 }
	const manyAtoms = f.silo.atomFamily<number, number>(family)
	f.silo.selector<number>({ key: `wide`, get: () => 0 })
	const outsideSelector = f.silo.selector<number>({
		key: `outside`,
		get: ({ get, find }) => get(find(manyAtoms, 10_000)),
	})
	f.mount()
	await settle()
	await f.select(`state:wide`)
	const related = new Set(
		Array.from({ length: 50_001 }, (_, index) => `missing${index}`),
	)
	f.silo.store.selectorGraph.relations.set(`wide`, related)
	f.silo.atom<number>({ key: `new`, default: 0 })
	await settle()
	expect(
		f.host.querySelector(`ecology-view [data-notice]`)!.textContent,
	).toContain(`full store totals unknown`)
	for (let index = 0; index < 10_001; index++)
		f.silo.store.families.get(manyAtoms.key)!.create(index)
	await settle()
	expect(f.host.querySelector(`ecology-editor`)!.textContent).toContain(
		`Selection outside this captured snapshot`,
	)
	const view = f.host.querySelector<HTMLElement>(`ecology-view`)!
	const jobs = view.dataset[`jobs`]
	expect(f.silo.getState(outsideSelector)).toBe(0)
	await settle()
	expect(view.dataset[`jobs`]).toBe(jobs)
	await f.select(`family:many`)
	expect(f.host.querySelector(`ecology-editor`)!.textContent).toContain(
		`+ members`,
	)
})

it(`preserves keyboard focus during live capture and highlights related cards when selection changes`, async () => {
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
	const graph = f.host.querySelector<HTMLElement>(
		`ecology-node-card > button[data-graph-id="state:s"]`,
	)!
	graph.focus()
	f.silo.atom<number>({ key: `new`, default: 0 })
	await settle()
	expect(document.activeElement?.getAttribute(`data-graph-id`)).toBe(`state:s`)
	await f.select(`state:a`)
	const tracedCards = f.host.querySelectorAll<HTMLElement>(
		`ecology-node-card[data-traced="true"] > button`,
	)
	expect([...tracedCards].map((card) => card.dataset[`graphId`]).sort()).toEqual(
		[`state:a`, `state:s`],
	)
})

it(`returns focus to search when a live capture removes selection controls or headings`, async () => {
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
		(button) => button.getAttribute(`aria-label`) === `Expand members`,
	)!
	expand.focus()
	const definition = f.silo.store.families.get(membersAtoms.key)!
	f.silo.store.families.delete(membersAtoms.key)
	f.silo.atom<number>({ key: `new`, default: 0 })
	await settle()
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
	await settle()
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

it(`selects every member of a family across expansion without losing member drafts or selecting other families`, async () => {
	const f = setup(),
		read = vi.fn(() => 1)
	const inputsAtoms = f.silo.atomFamily<number, string>({
		key: `inputs`,
		default: read,
	})
	const derivedSelectors = f.silo.selectorFamily<number, string>({
		key: `derived`,
		get: () => read,
	})
	for (const family of [inputsAtoms, derivedSelectors])
		for (const key of [`one`, `two`])
			f.silo.store.families.get(family.key)!.create(key)
	f.silo.store.valueMap.set(`inputs("one")`, 1)
	f.mount()
	await settle()
	const selectedRows = () =>
		[
			...f.host.querySelectorAll<HTMLElement>(
				`ecology-editor-row[data-section="selected"]`,
			),
		].map((row) => row.dataset[`rowId`])
	for (const key of [`inputs`, `derived`]) {
		await f.select(`family:${key}`)
		expect(selectedRows()).toEqual([`family:${key}`])
		await f.select(`family:${key}`, `Enter`)
		expect(selectedRows()).toEqual([
			`family:${key}`,
			`state:${key}("one")`,
			`state:${key}("two")`,
		])
		expect(
			f.host.querySelector(`[data-section-heading="selected"]`)!.textContent,
		).toBe(`Selected nodes`)
		expect(f.host.querySelector(`ecology-editor-row > details`)).toBeNull()
		const card = f.host.querySelector(
			`ecology-node-card > button[data-graph-id='state:${key}("one")']`,
		)!
		expect(card.querySelector(`strong`)!.textContent).toBe(`"one"`)
		expect(card.querySelector(`small[data-family]`)!.textContent).toBe(key)
		expect(card.getAttribute(`aria-label`)).toContain(`${key}("one")`)
		expect(card.getAttribute(`title`)).toContain(`${key}("one")`)
		expect(
			[
				...f.host.querySelectorAll<HTMLElement>(
					`ecology-node-card > button[aria-pressed="true"]`,
				),
			]
				.map((button) => button.dataset[`graphId`])
				.sort(),
		).toEqual(selectedRows().sort())
	}
	const input = f.host.querySelector<HTMLInputElement>(
		`state-leaf[data-state-key='inputs("one")'] input`,
	)!
	input.focus()
	input.value = `2e`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	await f.select(`family:inputs`)
	expect(selectedRows()).toEqual([
		`family:inputs`,
		`state:inputs("one")`,
		`state:inputs("two")`,
	])
	expect(
		f.host.querySelector(`state-leaf[data-state-key='inputs("one")'] input`),
	).toBe(input)
	expect(input.value).toBe(`2e`)
	await f.select(`state:inputs("one")`)
	expect(selectedRows()).toEqual([`state:inputs("one")`])
	await f.click(`Clear selection`)
	expect(selectedRows()).toEqual([])
	expect(
		f.host.querySelectorAll(`ecology-editor [aria-pressed="true"]`),
	).toHaveLength(0)
	expect(read).not.toHaveBeenCalled()
})

it(`previews visible cached values without evaluating state or invoking property getters`, async () => {
	const f = setup(),
		read = vi.fn(() => {
			throw new Error(`must not inspect`)
		})
	const object = Object.defineProperty({}, `hidden`, {
		enumerable: true,
		get: read,
	})
	const rejectPrototype = vi.fn(() => {
		throw new Error(`prototype unavailable`)
	})
	const proxy = new Proxy(
		{},
		{ get: read, getPrototypeOf: rejectPrototype, ownKeys: read },
	)
	class TransportError extends Error {}
	class Custom {
		public toString() {
			return `custom display`
		}
	}
	for (const [key, value] of [
		[`number`, 42],
		[`text`, `pantry`],
		[`object`, object],
		[`proxy`, proxy],
		[`undefined`, undefined],
		[`array`, [1, 2, 3]],
		[`map`, new Map([[1, 2]])],
		[`set`, new Set([1, 2])],
		[`error`, new TransportError()],
		[`custom`, new Custom()],
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
	expect(detail(`proxy`)).toBe(`Atom · {…}`)
	expect(detail(`array`)).toBe(`Atom · […3]`)
	expect(detail(`map`)).toBe(`Atom · Map(1)`)
	expect(detail(`set`)).toBe(`Atom · Set(2)`)
	expect(detail(`error`)).toBe(`Atom · TransportError`)
	expect(detail(`custom`)).toBe(`Atom · custom display`)
	expect(detail(`missing`)).toBe(`Atom · –`)
	expect(
		f.host.querySelector(`ecology-editor input[aria-label="number"]`),
	).not.toBeNull()
	expect(
		f.host.querySelector(`button[aria-label="Generate missing"]`),
	).not.toBeNull()
	expect(read).not.toHaveBeenCalled()
})

it(`keeps a muted Future check until another load or an error`, async () => {
	const f = setup()
	const workAtom = f.silo.atom<number | Error | Promise<number>, Error>({
		key: `work`,
		default: 0,
		catch: [Error],
	})
	f.mount()
	await settle()
	const card = f.host.querySelector<HTMLButtonElement>(
		`ecology-node-card button[data-graph-id="state:work"]`,
	)!
	f.silo.setState(workAtom, Promise.resolve(42))
	await vi.advanceTimersByTimeAsync(80)
	expect(card.textContent).toContain(`Atom · 42`)
	expect(card.dataset[`future`]).toBe(`loading`)
	await vi.advanceTimersByTimeAsync(950)
	expect(card.dataset[`future`]).toBe(`done`)
	await vi.advanceTimersByTimeAsync(950)
	expect(card.dataset[`future`]).toBe(`done`)
	await vi.advanceTimersByTimeAsync(100)
	expect(card.dataset[`future`]).toBe(`complete`)
	expect(card.getAttribute(`aria-description`)).toBe(`Load complete`)
	expect(card.querySelector(`[data-done-glyph]`)?.textContent).toBe(`✓`)
	f.silo.setState(workAtom, 7)
	await vi.advanceTimersByTimeAsync(2_000)
	expect(card.dataset[`future`]).toBe(`complete`)

	const next = Promise.withResolvers<number>()
	f.silo.setState(workAtom, next.promise)
	await vi.advanceTimersByTimeAsync(80)
	expect(card.dataset[`future`]).toBe(`loading`)
	next.resolve(5)
	await vi.advanceTimersByTimeAsync(2_000)
	expect(card.dataset[`future`]).toBe(`complete`)

	f.silo.setState(workAtom, new Error(`failed`))
	await vi.advanceTimersByTimeAsync(80)
	expect(card.dataset[`future`]).toBeUndefined()
	expect(card.dataset[`caught`]).toBe(`true`)
	f.silo.setState(workAtom, 0)
	await vi.advanceTimersByTimeAsync(80)
	expect(card.dataset[`future`]).toBeUndefined()

	f.silo.setState(workAtom, Promise.resolve(42))
	await vi.advanceTimersByTimeAsync(2_100)
	expect(card.dataset[`future`]).toBe(`complete`)
	const superseded = Promise.withResolvers<number>()
	f.silo.setState(workAtom, superseded.promise)
	f.silo.setState(workAtom, 9)
	superseded.resolve(10)
	await vi.advanceTimersByTimeAsync(2_100)
	expect(card.dataset[`future`]).toBeUndefined()
	expect(card.textContent).toContain(`Atom · 9`)
})

it(`remembers load completion when a family member returns to the graph`, async () => {
	const f = setup()
	const workAtoms = f.silo.atomFamily<number | Promise<number>, string>({
		key: `work`,
		default: 0,
	})
	const workAtom = f.silo.findState(workAtoms, `one`)
	expect(f.silo.getState(workAtom)).toBe(0)
	f.mount()
	await settle()
	f.silo.setState(workAtom, Promise.resolve(42))
	await settle()
	await f.click(`Expand work`)
	const card = () =>
		f.host.querySelector<HTMLButtonElement>(
			`ecology-node-card button[data-graph-id='state:${workAtom.key}']`,
		)
	expect(card()?.dataset[`future`]).toBe(`complete`)
	await f.click(`Collapse work`)
	expect(card()).toBeNull()
	await f.click(`Expand work`)
	expect(card()?.dataset[`future`]).toBe(`complete`)
})

it(`winds back once when a pending Future gets a new fate and uses stripes for its caught error`, async () => {
	const f = setup()
	const workAtom = f.silo.atom<number | Error | Promise<number | Error>, Error>({
		key: `work`,
		default: 0,
		catch: [Error],
	})
	f.mount()
	await settle()
	const card = f.host.querySelector<HTMLButtonElement>(
		`ecology-node-card button[data-graph-id="state:work"]`,
	)!
	f.silo.setState(workAtom, new Promise<number>(() => {}))
	await vi.advanceTimersByTimeAsync(1_100)
	expect(card.dataset[`future`]).toBe(`loading`)
	const request = Promise.withResolvers<number | Error>()
	f.silo.setState(workAtom, request.promise)
	await vi.advanceTimersByTimeAsync(20)
	expect(card.dataset[`future`]).toBe(`windback`)
	request.resolve(new Error(`failed`))
	await vi.advanceTimersByTimeAsync(20)
	expect(card.dataset[`caught`]).toBe(`true`) // This fixture prefers reduced motion.
	expect(card.querySelector(`img`)).toBeNull()
	await vi.advanceTimersByTimeAsync(500)
	expect(card.dataset[`future`]).toBeUndefined()
	f.silo.setState(workAtom, 7)
	await vi.advanceTimersByTimeAsync(20)
	expect(card.dataset[`caught`]).toBeUndefined()
})

it(`reveals the caught-error bands over one explosion cycle`, async () => {
	const f = setup()
	const media = window.matchMedia(`(prefers-reduced-motion: reduce)`)
	Object.defineProperty(media, `matches`, { value: false })
	vi.mocked(window.matchMedia).mockReturnValue(media)
	class TransportError extends Error {}
	const transportAtom = f.silo.atom<number, TransportError>({
		key: `transport`,
		default: () => {
			throw new TransportError(`carrier unavailable`)
		},
		catch: [TransportError],
	})
	f.mount()
	await settle()
	const card = f.host.querySelector<HTMLButtonElement>(
		`ecology-node-card button[data-graph-id="state:transport"]`,
	)!
	f.silo.getState(transportAtom)
	await vi.advanceTimersByTimeAsync(30)
	expect(card.textContent).toContain(`TransportError`)
	expect(card.dataset[`caught`]).toBe(`burst`)
	const image = card.querySelector(`img`)!
	expect(image.src).toContain(`kablooey.png`)
	image.dispatchEvent(new Event(`load`))
	expect(card.dataset[`caught`]).toBe(`revealing`)
	expect(
		image
			.closest<HTMLElement>(`[data-error-reveal]`)!
			.style.getPropertyValue(`--ecology-explosion-duration`),
	).toBe(`1700ms`)
	await vi.advanceTimersByTimeAsync(1_699)
	expect(card.querySelector(`img`)).toBe(image)
	expect(card.dataset[`caught`]).toBe(`revealing`)
	await vi.advanceTimersByTimeAsync(1)
	image.dispatchEvent(new Event(`animationend`))
	expect(card.querySelector(`img`)).toBeNull()
	expect(card.dataset[`caught`]).toBe(`true`)
	f.silo.atom<number>({ key: `new`, default: 0 })
	await settle()
	expect(card.querySelector(`img`)).toBeNull()
})

it(`ignores obsolete explosion events and cleans up without a CSS animation`, async () => {
	const button = document.createElement(`button`)
	const media = window.matchMedia(`(prefers-reduced-motion: reduce)`)
	Object.defineProperty(media, `matches`, { value: false, writable: true })
	const feedback = createCardFeedback(button, media)
	feedback.error(true, true)
	const obsolete = button.querySelector(`img`)!
	feedback.error(true, true)
	const active = button.querySelector(`img`)!
	obsolete.dispatchEvent(new Event(`load`))
	obsolete.dispatchEvent(new Event(`animationcancel`))
	expect(button.dataset[`caught`]).toBe(`burst`)
	expect(button.querySelector(`img`)).toBe(active)
	active.dispatchEvent(new Event(`load`))
	expect(button.dataset[`caught`]).toBe(`revealing`)
	await vi.advanceTimersByTimeAsync(1_800)
	expect(button.querySelector(`img`)).toBeNull()
	expect(button.dataset[`caught`]).toBe(`true`)

	feedback.error(true, true)
	Object.defineProperty(media, `matches`, { value: true })
	button.querySelector(`img`)!.dispatchEvent(new Event(`load`))
	expect(button.querySelector(`img`)).toBeNull()
	expect(button.dataset[`caught`]).toBe(`true`)
	feedback.dispose()
})

it(`animates completion when a Future resolves before the card observes it loading`, async () => {
	const button = document.createElement(`button`)
	const feedback = createCardFeedback(button, window.matchMedia(`all`))
	feedback.future(false, true, new Set([`resolved`]))
	expect(button.dataset[`future`]).toBe(`done`)
	await vi.advanceTimersByTimeAsync(1_000)
	expect(button.dataset[`future`]).toBe(`complete`)
	feedback.dispose()
})

it(`shows a second windback if the Future is replaced during windback`, async () => {
	const button = document.createElement(`button`)
	const feedback = createCardFeedback(button, window.matchMedia(`all`))
	feedback.future(true, false)
	await vi.advanceTimersByTimeAsync(1_000)
	feedback.future(true, false, new Set([`replaced`]))
	expect(button.dataset[`future`]).toBe(`windback`)
	await vi.advanceTimersByTimeAsync(250)
	feedback.future(true, false, new Set([`replaced`]))
	await vi.advanceTimersByTimeAsync(250)
	expect(button.dataset[`future`]).toBe(`windback`)
	await vi.advanceTimersByTimeAsync(500)
	expect(button.dataset[`future`]).toBe(`loading`)
	feedback.dispose()
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
	const uncachedAtom = f.silo.atom<number>({ key: `uncached`, default: () => 1 })
	f.silo.selector<number>({ key: `readonly`, get: () => 3 })
	f.silo.selector<number>({ key: `failed`, get: failed })
	f.mount()
	await settle()
	await f.select(`state:object`)
	expect(get).not.toHaveBeenCalled()
	expect(
		f.host.querySelector(`button[aria-label="Generate object"] svg`),
	).not.toBeNull()
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
	await f.click(`Add property`)
	expect(f.silo.getState(objectAtom)).toHaveProperty(`new`, null)
	await f.click(`Expand nested`)
	expect(
		f.host.querySelector(`ecology-editor input[aria-label="enabled"]`),
	).not.toBeNull()
	await f.click(`Reset object`)
	expect(get).toHaveBeenCalledTimes(2)
	expect(f.silo.getState(objectAtom)).toEqual({
		quantity: 2,
		nested: { enabled: true },
	})
	await f.click(`Reset uncached`)
	expect(f.silo.store.valueMap.get(uncachedAtom.key)).toBe(1)
	expect(document.activeElement?.getAttribute(`aria-label`)).toBe(`uncached`)
	await f.select(`state:readonly`)
	await f.click(`Generate readonly`)
	expect(document.activeElement?.getAttribute(`aria-label`)).toBe(`readonly`)
	expect(
		f.host
			.querySelector(`ecology-editor input[aria-label="readonly"]`)!
			.hasAttribute(`readonly`),
	).toBe(true)
	expect(f.host.querySelector(`button[aria-label="Reset readonly"]`)).toBeNull()
	await f.select(`state:failed`)
	await f.click(`Generate failed`)
	expect(failed).toHaveBeenCalledTimes(1)
	expect(f.host.textContent).toContain(`generation failed`)
})

it(`refuses to generate a replacement atom from a stale row`, async () => {
	const f = setup()
	const read = vi.fn(() => 1)
	const itemsAtoms = f.silo.atomFamily<number, string>({
		key: `items`,
		default: read,
	})
	const family = f.silo.store.families.get(itemsAtoms.key)!
	family.create(`one`)
	f.mount()
	await settle()
	await f.click(`Expand items`)
	const generate = f.host.querySelector<HTMLButtonElement>(
		`button[aria-label='Generate items("one")']`,
	)!
	f.silo.disposeState(itemsAtoms, `one`)
	family.create(`one`)
	generate.click()
	await settle()
	expect(f.host.textContent).toContain(`State was disposed.`)
	expect(read).not.toHaveBeenCalled()
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
	expect(
		f.host.querySelector(`[data-graph-id='state:ephemeral("one")']`),
	).toBeNull()
	expect(document.activeElement?.getAttribute(`aria-label`)).toBe(
		`Search ecology`,
	)
})

it(`opens the retained source outcome after inspecting a scoped timeline event`, async () => {
	const f = setup()
	const cartItemsAtom = f.silo.atom<string[]>({ key: `cartItems`, default: [] })
	const sessionSavedAtom = f.silo.atom<boolean>({
		key: `sessionSaved`,
		default: false,
	})
	f.silo.getState(cartItemsAtom)
	f.silo.getState(sessionSavedAtom)
	f.silo.timeline({ key: `cart history`, scope: [cartItemsAtom] })
	const saveCartTransaction = f.silo.transaction({
		key: `saveCart`,
		do: ({ set }) => {
			set(cartItemsAtom, [`beans`, `mug`])
			set(sessionSavedAtom, true)
		},
	})
	f.mount()
	await settle()
	f.silo.setState(cartItemsAtom, [`beans`])
	f.silo.runTransaction(saveCartTransaction)()
	await settle()
	await f.click(`Expand timeline cart history`)
	const history = f.host.querySelector(`timeline-history`)!
	const [first, second] = history.querySelectorAll<HTMLElement>(
		`event-view[data-timeline-event]`,
	)
	expect(first.textContent).toContain(`1 · cartItems`)
	expect(second.textContent).toContain(`2 · saveCart`)
	expect(history.querySelector(`outcome-collection-change`)).toBeNull()
	await f.click(`Expand 1 · cartItems`)
	expect(
		first.querySelector(`[data-snapshot-diff="after"] outcome-value`)
			?.textContent,
	).toBe(`"beans"`)
	expect(first.querySelector(`button[data-graph-id]`)).not.toBeNull()
	const title = second.querySelector<HTMLButtonElement>(`button[data-graph-id]`)!
	title.focus()
	for (const modifiers of [{ repeat: true }, { ctrlKey: true }]) {
		title.dispatchEvent(
			new KeyboardEvent(`keydown`, {
				key: `Enter`,
				bubbles: true,
				cancelable: true,
				...modifiers,
			}),
		)
		await settle()
		expect(second.querySelector(`outcome-collection-change`)).toBeNull()
	}
	title.dispatchEvent(
		new KeyboardEvent(`keydown`, {
			key: `Enter`,
			bubbles: true,
			cancelable: true,
		}),
	)
	await settle()
	expect(
		second.querySelector(`[data-snapshot-diff="after"] outcome-value`)
			?.textContent,
	).toBe(`"mug"`)
	expect(second.textContent).not.toContain(`sessionSaved`)
	await f.click(`undo`)
	expect(second.dataset[`timelineState`]).toBe(`future`)
	expect(second.querySelector(`[data-redo-next]`)?.textContent).toBe(`Redo next`)
	expect(
		second.querySelector(`[data-snapshot-diff="after"] outcome-value`)
			?.textContent,
	).toBe(`"mug"`)
	expect(
		f.host.querySelector(`[data-history="future"] strong`)?.textContent,
	).toBe(`2 · saveCart`)

	// Selecting the linked outcome also works when the active filter only matches its timeline.
	await f.search(`cart history`)
	await f.click(`View outcome`)
	const source = f.host.querySelector(
		`ecology-editor transaction-outcomes event-view`,
	)!
	expect(source.textContent).toContain(`sessionSaved`)
	expect(source.querySelector(`button[data-graph-id]`)).toBe(
		document.activeElement,
	)
	expect(source.getAttribute(`data-selected`)).toBe(`true`)
	expect(
		f.host.querySelector(`[data-history="outcome"] button[aria-pressed="true"]`),
	).not.toBeNull()
})
