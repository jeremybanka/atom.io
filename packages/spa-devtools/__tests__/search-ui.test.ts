import { Silo } from "atom.io"
import { isReservedIntrospectionKey } from "atom.io/internal"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { mountAtomIODevtools } from "../src/mount.ts"
import { captureStateSearch, indexStateSearch } from "../src/search.ts"
import { createSearchSession } from "../src/search-session.ts"
import { mountSearchFixture } from "./fixtures/views.tsx"

let dispose = () => {}
beforeEach(() => {
	vi.useFakeTimers()
	localStorage.clear()
})
afterEach(() => {
	dispose()
	document.body.replaceChildren()
	localStorage.clear()
	vi.useRealTimers()
})
async function settle() {
	for (let i = 0; i < 5; i++) await Promise.resolve()
	await vi.runAllTimersAsync()
	for (let i = 0; i < 5; i++) await Promise.resolve()
}
function setup() {
	const silo = new Silo({
		name: `search-controls`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 2 })
	const recordAtom = silo.atom<{ a: number; b: number }>({
		key: `record`,
		default: { a: 1, b: 2 },
	})
	const host = document.createElement(`div`)
	document.body.append(host)
	const input = () =>
		host.querySelector<HTMLInputElement>(`[aria-label="Search atoms"]`)!
	const button = (label: string) =>
		[...host.querySelectorAll<HTMLButtonElement>(`button`)].find(
			(node) =>
				node.textContent === label || node.getAttribute(`aria-label`) === label,
		)!
	const mount = async () => {
		dispose = mountAtomIODevtools(host, { store: silo.store }).dispose
		await settle()
	}
	const search = async (text: string) => {
		input().focus()
		input().value = text
		input().dispatchEvent(new Event(`input`, { bubbles: true }))
		await settle()
	}
	const key = (target: Element, value: string, extra = {}) => {
		const event = new KeyboardEvent(`keydown`, {
			key: value,
			bubbles: true,
			cancelable: true,
			...extra,
		})
		target.dispatchEvent(event)
		return event
	}
	return { silo, countAtom, recordAtom, host, input, button, mount, search, key }
}

it(`keeps capture notes available and their disclosure open across filtering and refresh`, async () => {
	const f = setup()
	await f.mount()
	const disclosure = f.host.querySelector<HTMLDetailsElement>(
		`search-controls details[data-capture]`,
	)!
	expect(disclosure.textContent).toContain(`complex values skipped`)
	expect(disclosure.open).toBe(false)
	disclosure.open = true
	const capture = f.host.querySelector(
		`search-view [data-search-status]`,
	)!.textContent
	await f.search(`count`)
	f.button(`Refresh`).click()
	await settle()
	expect(f.host.querySelector(`search-controls details[data-capture]`)).toBe(
		disclosure,
	)
	expect(disclosure.open).toBe(true)
	expect(capture).toContain(`captured records`)
	expect(
		f.host.querySelector(`search-view [data-search-status]`)!.textContent,
	).toContain(`1 match`)
	expect(f.silo.getState(f.countAtom)).toBe(2)
})

it(`keeps numeric draft, selection and node identity through filtering, clear and Refresh, then uses normal blur on deliberate exit`, async () => {
	const f = setup()
	await f.mount()
	const editor = f.host.querySelector<HTMLInputElement>(
		`[data-testid="state-value-count"] input`,
	)!
	editor.focus()
	editor.value = `1e`
	editor.dispatchEvent(new Event(`input`, { bubbles: true }))
	editor.setSelectionRange(1, 2)
	await f.search(`no-matches`)
	expect(editor.value).toBe(`1e`)
	expect(f.silo.getState(f.countAtom)).toBe(2)
	expect(f.host.textContent).toContain(`Editing — kept visible`)
	expect(editor.closest<HTMLElement>(`state-leaf`)!.hidden).toBe(false)
	f.button(`Refresh`).click()
	await settle()
	expect(editor.value).toBe(`1e`)
	f.key(f.input(), `Escape`)
	await settle()
	expect(f.input().value).toBe(``)
	f.key(f.input(), `Escape`)
	expect(document.activeElement).toBe(editor)
	expect(editor.selectionStart).toBe(1)
	expect(editor.selectionEnd).toBe(2)
	expect(f.host.querySelector(`[data-testid="state-value-count"] input`)).toBe(
		editor,
	)
	await f.search(`count`)
	f.button(`Move debugger`).focus()
	expect(editor.value).toBe(`2`)
	expect(f.silo.getState(f.countAtom)).toBe(2)
})

it(`keeps rename draft passive through selection and refresh, then commits on deliberate normal exit with existing collision validation`, async () => {
	const f = setup()
	await f.mount()
	f.host
		.querySelector<HTMLButtonElement>(
			`[data-testid="state-value-record"] button`,
		)!
		.click()
	await settle()
	const rename = f.host.querySelector<HTMLInputElement>(
		`[aria-label="Rename a"]`,
	)!
	expect(rename).not.toBeNull()
	rename.focus()
	rename.value = `renamed`
	rename.dispatchEvent(new Event(`input`, { bubbles: true }))
	await f.search(`count`)
	const hit = f.host.querySelector<HTMLButtonElement>(
		`[data-search-id="state:count"]`,
	)!
	hit.focus()
	hit.click()
	await settle()
	expect(f.silo.getState(f.recordAtom)).toEqual({ a: 1, b: 2 })
	expect(rename.value).toBe(`renamed`)
	f.button(`Refresh`).click()
	await settle()
	expect(rename.isConnected).toBe(true)
	f.button(`Move debugger`).focus()
	await settle()
	expect(f.silo.getState(f.recordAtom)).toEqual({ renamed: 1, b: 2 })
})

it(`uses panel-local shortcuts, passive keyboard results and two-stage Escape; preserves browser find and IME`, async () => {
	const f = setup()
	await f.mount()
	const move = f.button(`Move debugger`)
	move.focus()
	expect(
		f.key(move, `f`, { ctrlKey: true, shiftKey: true }).defaultPrevented,
	).toBe(true)
	expect(document.activeElement).toBe(f.input())
	expect(f.key(f.input(), `f`, { ctrlKey: true }).defaultPrevented).toBe(false)
	expect(f.key(f.input(), `/`, { isComposing: true }).defaultPrevented).toBe(
		false,
	)
	await f.search(`count`)
	for (const extra of [
		{ ctrlKey: true },
		{ metaKey: true },
		{ altKey: true },
		{ shiftKey: true },
	]) {
		expect(f.key(f.input(), `Escape`, extra).defaultPrevented).toBe(false)
		expect(f.input().value).toBe(`count`)
	}
	f.key(f.input(), `Home`)
	expect(document.activeElement).toBe(f.input())
	f.key(f.input(), `ArrowDown`)
	const hit = document.activeElement as HTMLButtonElement
	expect(hit.dataset[`searchId`]).toBe(`state:count`)
	f.key(hit, `Home`)
	f.key(hit, `End`)
	f.key(hit, `ArrowUp`)
	hit.click()
	await settle()
	expect(f.host.querySelector(`search-details`)!.textContent).toContain(
		`Return to live editor`,
	)
	f.key(hit, `Escape`)
	expect(document.activeElement).toBe(f.input())
	f.key(f.input(), `Escape`)
	await settle()
	f.key(f.input(), `Escape`)
	expect(document.activeElement).toBe(move)
	f.key(move, `/`)
	expect(document.activeElement).toBe(f.input())
	await f.search(`count`)
	const panel = f.host.querySelector<HTMLElement>(`debugger-panel`)!
	panel.dataset[`windowInteraction`] = `true`
	expect(f.key(f.input(), `Escape`).defaultPrevented).toBe(true)
	expect(f.input().value).toBe(`count`)
	delete panel.dataset[`windowInteraction`]
	f.button(`Clear`).click()
	await settle()
	expect(f.input().value).toBe(``)
})

it(`uses copied values until Refresh, retains last valid results on validation, cancels superseded jobs and scopes contexts to store`, async () => {
	const f = setup()
	await f.mount()
	await f.search(`2`)
	f.silo.setState(f.countAtom, 17)
	await settle()
	await f.search(`17`)
	expect(f.host.querySelectorAll(`search-results li`)).toHaveLength(0)
	f.button(`Refresh`).click()
	await settle()
	expect(f.host.querySelector(`[data-search-id="state:count"]`)).not.toBeNull()
	await f.search(`x`.repeat(257))
	expect(f.host.querySelector(`[data-search-id="state:count"]`)).not.toBeNull()
	expect(
		f.host.querySelector(`search-view [data-search-status]`)!.textContent,
	).toContain(`256`)
	f.input().value = `old`
	f.input().dispatchEvent(new Event(`input`))
	f.input().value = `count`
	f.input().dispatchEvent(new Event(`input`))
	await settle()
	expect(f.host.querySelectorAll(`search-results li`)).toHaveLength(1)
	f.button(`Minimize debugger`).click()
	await settle()
	f.button(`Open debugger`).click()
	await settle()
	expect(f.input().value).toBe(`count`)
	dispose()
	await settle()
	const replacement = new Silo({
		name: `other`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	dispose = mountAtomIODevtools(f.host, { store: replacement.store }).dispose
	await settle()
	expect(f.input().value).toBe(``)
	expect(
		f.host.querySelector(`search-view [data-search-status]`)!.textContent,
	).toContain(`0 captured records`)
})

it(`does not expand or evaluate a dormant family member during matching or passive selection; explicit open may evaluate`, async () => {
	const f = setup(),
		defaults = vi.fn(() => 8)
	const itemsAtoms = f.silo.atomFamily<number, string>({
		key: `items`,
		default: defaults,
	})
	const member = f.silo.store.families.get(itemsAtoms.key)!.create(`a`)
	await f.mount()
	await f.search(`items`)
	const before = [...f.silo.store.valueMap].filter(
			([key]) => !isReservedIntrospectionKey(key),
		),
		graph = f.silo.store.selectorGraph.toJSON()
	const hit = f.host.querySelector<HTMLButtonElement>(
		`[data-search-id='state:${member.key}']`,
	)!
	hit.click()
	await settle()
	expect(defaults).not.toHaveBeenCalled()
	expect(
		[...f.silo.store.valueMap].filter(
			([key]) => !isReservedIntrospectionKey(key),
		),
	).toEqual(before)
	expect(f.silo.store.selectorGraph.toJSON()).toEqual(graph)
	f.button(`Open live editor (may read/evaluate)`).click()
	await settle()
	expect(defaults).toHaveBeenCalledTimes(1)
	expect(f.host.querySelector(`search-live-editor input`)).not.toBeNull()
	await f.search(`count`)
	expect(f.host.querySelector(`search-live-editor input`)).not.toBeNull()
})

it(`releases stale deferred rename on external replacement without applying it to new state`, async () => {
	const f = setup()
	await f.mount()
	f.button(`Expand record`).click()
	await settle()
	const rename = f.host.querySelector<HTMLInputElement>(
		`[aria-label="Rename a"]`,
	)!
	rename.focus()
	rename.value = `stale`
	rename.dispatchEvent(new Event(`input`, { bubbles: true }))
	await f.search(`count`)
	f.silo.setState(f.recordAtom, { a: 40, b: 50 })
	await settle()
	f.button(`Move debugger`).focus()
	await settle()
	expect(f.silo.getState(f.recordAtom)).toEqual({ a: 40, b: 50 })
	expect(rename.value).toBe(`a`)
})

it(`searches selectors with independent context and returns to the same mounted editor; family metadata stays passive`, async () => {
	const f = setup(),
		getter = vi.fn(() => 6)
	const membersSelectors = f.silo.selectorFamily<number, string>({
		key: `members`,
		get: () => getter,
	})
	f.silo.store.families.get(membersSelectors.key)!.create(`a`)
	await f.mount()
	await f.search(`count`)
	f.host
		.querySelector<HTMLButtonElement>(`[data-testid="view-selectors"]`)!
		.click()
	await settle()
	const input = f.host.querySelector<HTMLInputElement>(
		`[aria-label="Search selectors"]`,
	)!
	input.value = `members`
	input.dispatchEvent(new Event(`input`))
	await settle()
	f.host
		.querySelector<HTMLButtonElement>(`[data-search-id="family:members"]`)!
		.click()
	await settle()
	expect(f.host.querySelector(`search-details`)!.textContent).toContain(
		`Registered family`,
	)
	expect(getter).not.toHaveBeenCalled()
	f.host.querySelector<HTMLButtonElement>(`[data-testid="view-atoms"]`)!.click()
	await settle()
	expect(f.input().value).toBe(`count`)
	f.host
		.querySelector<HTMLButtonElement>(`[data-search-id="state:count"]`)!
		.click()
	await settle()
	f.button(`Return to live editor`).click()
	await settle()
	expect(document.activeElement).toBe(
		f.host.querySelector(`[data-testid="state-value-count"] input`),
	)
})

it(`defers Refresh during commit and suspends queries and jobs while hidden, including composition`, async () => {
	const f = setup()
	await f.mount()
	const transaction = {} as NonNullable<
		typeof f.silo.store.on.transactionApplying.state
	>
	f.silo.store.on.transactionApplying.next(transaction)
	f.button(`Refresh`).click()
	await settle()
	expect(
		f.host.querySelector(`search-view [data-search-status]`)!.textContent,
	).toContain(`Waiting`)
	f.input().value = `count`
	f.input().dispatchEvent(new Event(`input`))
	f.silo.store.on.transactionApplying.next(transaction)
	f.silo.store.on.transactionApplying.next(null)
	await settle()
	expect(f.host.querySelector(`[data-search-id="state:count"]`)).not.toBeNull()
	const panel = f.host.querySelector<HTMLElement>(`debugger-panel`)!
	panel.hidden = true
	await settle()
	f.input().dispatchEvent(new InputEvent(`input`, { isComposing: true }))
	f.input().dispatchEvent(new Event(`compositionend`))
	f.button(`Refresh`).click()
	await settle()
	expect(f.key(f.input(), `/`).defaultPrevented).toBe(false)
	panel.hidden = false
	await settle()
	f.input().value = `coUnt`
	f.input().dispatchEvent(new Event(`input`))
	f.host
		.querySelector<HTMLButtonElement>(`[data-search-id="state:count"]`)!
		.click()
	await settle()
	expect(f.host.querySelector(`search-details`)!.textContent).toBe(``)
	await settle()
	for (const extra of [
		{ ctrlKey: true },
		{ metaKey: true },
		{ altKey: true },
		{ shiftKey: true },
		{ isComposing: true },
	])
		f.key(f.input(), `ArrowDown`, extra)
	f.key(f.input(), `f`, { metaKey: true, shiftKey: true })
	f.key(f.input(), `ArrowUp`)
	f.key(document.activeElement!, `ArrowDown`)
	await f.search(`nope`)
	f.key(f.input(), `ArrowDown`)
	f.key(f.input(), `ArrowUp`)
	f.button(`Clear`).click()
	await settle()
})

it(`opens and retains selected family editors across queries/Refresh, replaces deliberately, and reports disposal without recreation`, async () => {
	const f = setup()
	const itemsAtoms = f.silo.atomFamily<number, string>({
		key: `items`,
		default: 1,
	})
	for (const key of [`a`, `b`, `c`])
		f.silo.store.families.get(itemsAtoms.key)!.create(key)
	await f.mount()
	await f.search(`items`)
	const choose = async (key: string) => {
		f.host
			.querySelector<HTMLButtonElement>(
				`[data-search-id='state:items("${key}")']`,
			)!
			.click()
		await settle()
	}
	await choose(`a`)
	const open = f.button(`Open live editor (may read/evaluate)`)
	open.click()
	await settle()
	open.click()
	await settle()
	const input = f.host.querySelector<HTMLInputElement>(
		`search-live-editor input`,
	)!
	input.focus()
	input.value = `1e`
	input.dispatchEvent(new Event(`input`))
	await f.search(`items`)
	await choose(`a`)
	f.button(`Return to live editor`).click()
	await settle()
	expect(document.activeElement).toBe(input)
	expect(input.value).toBe(`1e`)
	await f.search(`items`)
	await choose(`b`)
	f.button(`Open live editor (may read/evaluate)`).click()
	await settle()
	expect(input.isConnected).toBe(false)
	f.button(`Refresh`).click()
	await settle()
	expect(f.host.querySelector(`search-live-editor input`)).not.toBeNull()
	f.silo.disposeState(itemsAtoms, `b`)
	await settle()
	f.button(`Refresh`).click()
	await settle()
	expect(f.host.querySelector(`search-live-editor input`)).toBeNull()
	await choose(`c`)
	f.silo.disposeState(itemsAtoms, `c`)
	await settle()
	f.button(`Open live editor (may read/evaluate)`).click()
	await settle()
	f.button(`Open live editor (may read/evaluate)`).click()
	await settle()
	expect(f.host.querySelector(`search-live-editor`)!.textContent).toContain(
		`disposed`,
	)
})

it(`selects complex cached value and typo metadata without evaluating object contents`, async () => {
	const f = setup()
	await f.mount()
	await f.search(`record`)
	f.host
		.querySelector<HTMLButtonElement>(`[data-search-id="state:record"]`)!
		.click()
	await settle()
	expect(f.host.querySelector(`search-details`)!.textContent).toContain(
		`Complex value skipped`,
	)
	await f.search(`recod`)
	expect(f.host.querySelector(`search-results`)!.textContent).toContain(
		`approximate match`,
	)
})

it(`reports partial/truncated capture and approximation cutoff honestly rather than claiming global no matches`, async () => {
	const silo = new Silo({
		name: `bounded`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	silo.atomFamily<number, string>({ key: `empty`, default: 0 })
	for (let i = 0; i < 10_000; i++) {
		const key = `${`a`.repeat(61)}b-${i}`
		silo.atom<string>({ key, default: `` })
		silo.store.valueMap.set(key, `x`.repeat(2_000))
	}
	const copy = captureStateSearch(silo.store, `atoms`, { maxNodes: 9_999 })!
	const iterator = indexStateSearch(copy)
	let step = iterator.next()
	while (!step.done) step = iterator.next()
	const context = {
		query: `${`a`.repeat(61)}c `.repeat(4).trim(),
		index: step.value,
	}
	const panel = document.createElement(`debugger-panel`)
	document.body.append(panel)
	const mounted = mountSearchFixture(panel, silo.store, context)
	const host = mounted.host
	dispose = mounted.dispose
	await settle()
	expect(
		host.querySelector(`search-view [data-search-status]`)!.textContent,
	).toContain(`Partial capture`)
	expect(
		host.querySelector(`search-view [data-search-status]`)!.textContent,
	).toContain(`text prefixes truncated`)
	expect(
		host.querySelector(`search-view [data-search-status]`)!.textContent,
	).toContain(`Approximate search limited`)
	expect(host.querySelectorAll(`search-results li`)).toHaveLength(100)
})

it(`defers initial capture of a hidden panel until visible, with shortcuts inert and no late callbacks after disposal`, async () => {
	const f = setup()
	dispose = mountAtomIODevtools(f.host, {
		store: f.silo.store,
		hideByDefault: true,
	}).dispose
	const input = f.input()
	input.dispatchEvent(new Event(`input`))
	f.button(`Refresh`).click()
	await settle()
	expect(
		f.host.querySelector(`search-results`)!.getAttribute(`aria-busy`),
	).toBeNull()
	const panel = f.host.querySelector<HTMLElement>(`debugger-panel`)!
	panel.hidden = false
	await settle()
	expect(
		f.host.querySelector(`search-view [data-search-status]`)!.textContent,
	).toContain(`captured records`)
	input.value = `count`
	input.dispatchEvent(new Event(`input`))
	dispose()
	await settle()
	expect(f.host.querySelector(`search-controls`)).toBeNull()
})

it(`opens readonly and writable selector members explicitly, retains live selection, and never creates a disposed target`, async () => {
	const f = setup()
	const plainSelectors = f.silo.selectorFamily<number, string>({
		key: `plain`,
		get: () => () => 4,
	})
	const editedSelectors = f.silo.selectorFamily<number, string>({
		key: `edited`,
		get: () => () => 5,
		set: () => () => {},
	})
	f.silo.store.families.get(plainSelectors.key)!.create(`a`)
	f.silo.store.families.get(editedSelectors.key)!.create(`a`)
	await f.mount()
	f.host
		.querySelector<HTMLButtonElement>(`[data-testid="view-selectors"]`)!
		.click()
	await settle()
	const input = f.host.querySelector<HTMLInputElement>(
		`[aria-label="Search selectors"]`,
	)!
	for (const family of [`plain`, `edited`]) {
		input.value = family
		input.dispatchEvent(new Event(`input`))
		await settle()
		f.host
			.querySelector<HTMLButtonElement>(
				`[data-search-id='state:${family}("a")']`,
			)!
			.click()
		await settle()
		f.button(`Open live editor (may read/evaluate)`).click()
		await settle()
		const editor = f.host.querySelector<HTMLInputElement>(
			`search-live-editor input`,
		)!
		editor.focus()
		input.focus()
		await settle()
		f.button(`Refresh`).click()
		await settle()
		f.host
			.querySelector<HTMLButtonElement>(
				`[data-search-id='state:${family}("a")']`,
			)!
			.click()
		await settle()
		f.button(`Return to live editor`).click()
		await settle()
		expect(document.activeElement).toBe(editor)
	}
})

it(`focus session handles explicit editor exit, checkbox return, stale unlabelled inputs and disconnected targets without writes`, () => {
	const panel = document.createElement(`debugger-panel`),
		search = document.createElement(`section`),
		field = document.createElement(`input`),
		leaf = document.createElement(`state-leaf`),
		editor = document.createElement(`input`)
	leaf.append(editor)
	search.append(field)
	panel.append(search, leaf)
	document.body.append(panel)
	const changed = vi.fn(),
		blur = vi.fn()
	let valid = true
	const session = createSearchSession(panel, search, changed, () => () => valid)
	editor.addEventListener(`focusout`, blur)
	editor.focus()
	field.focus()
	expect(blur).not.toHaveBeenCalled()
	session.finish(null)
	expect(blur).toHaveBeenCalledTimes(1)
	editor.focus()
	field.focus()
	session.returnFocus()
	editor.blur()
	expect(session.pinned()).toBeNull()
	editor.type = `checkbox`
	editor.focus()
	field.focus()
	session.returnFocus()
	expect(document.activeElement).toBe(editor)
	field.focus()
	valid = false
	expect(session.pinned()).toBeNull()
	valid = true
	editor.focus()
	field.focus()
	editor.remove()
	session.finish(field)
	expect(session.pinned()).toBeNull()
	session.dispose()
})

it(`ArrowUp navigates backwards from later results without changing the search text`, async () => {
	const f = setup()
	await f.mount()
	await f.search(`o`)
	f.key(f.input(), `ArrowDown`)
	f.key(document.activeElement!, `End`)
	const before = document.activeElement
	f.key(before!, `ArrowUp`)
	expect(document.activeElement).not.toBe(before)
	expect(f.input().value).toBe(`o`)
})

it(`deferred rename still performs collision validation only on deliberate exit`, async () => {
	const f = setup()
	await f.mount()
	f.button(`Expand record`).click()
	await settle()
	const rename = f.host.querySelector<HTMLInputElement>(
		`[aria-label="Rename a"]`,
	)!
	rename.focus()
	rename.value = `b`
	rename.dispatchEvent(new Event(`input`, { bubbles: true }))
	await f.search(`count`)
	expect(f.host.querySelector(`[role="alert"]`)).toBeNull()
	expect(f.silo.getState(f.recordAtom)).toEqual({ a: 1, b: 2 })
	f.button(`Move debugger`).focus()
	await settle()
	expect(f.silo.getState(f.recordAtom)).toEqual({ a: 1, b: 2 })
	expect(f.host.querySelector(`[role="alert"]`)!.textContent).toContain(
		`already exists`,
	)
})

it(`takes a new committed-root copy on each ordinary view entry without persisting an index`, async () => {
	const f = setup()
	await f.mount()
	await f.search(`17`)
	expect(f.host.querySelectorAll(`search-results li`)).toHaveLength(0)
	f.host
		.querySelector<HTMLButtonElement>(`[data-testid="view-selectors"]`)!
		.click()
	await settle()
	f.silo.setState(f.countAtom, 17)
	await settle()
	f.host.querySelector<HTMLButtonElement>(`[data-testid="view-atoms"]`)!.click()
	await settle()
	expect(f.input().value).toBe(`17`)
	expect(f.host.querySelector(`[data-search-id="state:count"]`)).not.toBeNull()
})

it(`ignores result gutters and a live action superseded by a new search`, async () => {
	const f = setup()
	await f.mount()
	await f.search(`count`)
	f.host.querySelector<HTMLElement>(`search-results li`)!.click()
	await settle()
	expect(f.host.querySelector(`search-details h2`)).toBeNull()
	f.host.querySelector<HTMLButtonElement>(`search-results button`)!.click()
	await settle()
	const open = f.button(`Return to live editor`)
	f.input().value = `absent`
	f.input().dispatchEvent(new Event(`input`, { bubbles: true }))
	vi.runAllTimers()
	open.click()
	await settle()
	expect(f.host.querySelector(`search-live-editor input`)).toBeNull()
	expect(f.host.querySelector(`search-details h2`)).toBeNull()
})
