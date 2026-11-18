import { Silo } from "atom.io"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { historyIdentity } from "../src/history-search.ts"
import { mountAtomIODevtools } from "../src/mount.ts"

let dispose = () => {}
beforeEach(() => {
	vi.useFakeTimers()
	localStorage.clear()
})
afterEach(() => {
	dispose()
	document.body.replaceChildren()
	vi.useRealTimers()
	vi.restoreAllMocks()
})
async function settle() {
	for (let i = 0; i < 5; i++) await Promise.resolve()
	await vi.runAllTimersAsync()
	for (let i = 0; i < 5; i++) await Promise.resolve()
}
async function setup() {
	const app = new Silo({
		name: `history-ui`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const cartQuantityAtom = app.atom<number>({ key: `cartQuantity`, default: 0 })
	const innerChangeTransaction = app.transaction<(value: number) => void>({
		key: `innerChange`,
		do: ({ set }, value) => {
			set(cartQuantityAtom, value)
		},
	})
	const changeCartTransaction = app.transaction<(value: number) => void>({
		key: `changeCart`,
		do: ({ run }, value) => {
			run(innerChangeTransaction)(value)
		},
	})
	const cartHistoryTimeline = app.timeline({
		key: `cartHistory`,
		scope: [cartQuantityAtom],
	})
	const host = document.createElement(`div`)
	document.body.append(host)
	dispose = mountAtomIODevtools(host, { store: app.store }).dispose
	await settle()
	const tab = async (view: string) => {
		host
			.querySelector<HTMLButtonElement>(`[data-testid="view-${view}"]`)!
			.click()
		await settle()
	}
	const input = () =>
		host.querySelector<HTMLInputElement>(`input[type="search"]`)!
	const query = async (text: string) => {
		input().focus()
		input().value = text
		input().dispatchEvent(new Event(`input`, { bubbles: true }))
		await settle()
	}
	const refresh = async () => {
		;[...host.querySelectorAll(`button`)]
			.find((b) => b.textContent === `Refresh`)!
			.click()
		await settle()
	}
	const key = async (target: HTMLElement, value: string, extra = {}) => {
		target.dispatchEvent(
			new KeyboardEvent(`keydown`, {
				key: value,
				bubbles: true,
				cancelable: true,
				...extra,
			}),
		)
		await settle()
	}
	await tab(`transactions`)
	app.runTransaction(changeCartTransaction)(7)
	await settle()
	await refresh()
	return {
		app,
		cartQuantityAtom,
		changeCartTransaction,
		cartHistoryTimeline,
		host,
		tab,
		input,
		query,
		refresh,
		key,
	}
}

it(`reveals nested recorded events, preserves chronology/cursor and uses keyboard results and Escape`, async () => {
	const f = await setup()
	await f.query(`cartQuantity`)
	const hits = [
		...f.host.querySelectorAll<HTMLButtonElement>(`search-results button`),
	]
	expect(hits.length).toBeGreaterThan(0)
	await f.key(f.input(), `ArrowDown`)
	expect(document.activeElement).toBe(hits[0])
	hits[0].click()
	await settle()
	const selected = f.host.querySelector<HTMLElement>(
		`[data-search-selected="true"]`,
	)!
	expect(selected).not.toBeNull()
	expect(selected.dataset[`testid`]).toContain(`cartQuantity`)
	expect(document.activeElement).toBe(selected)
	expect(f.app.getState(f.cartQuantityAtom)).toBe(7)
	await f.key(selected, `Escape`)
	expect(document.activeElement).toBe(f.input())
	hits[0].click()
	await settle()
	await f.tab(`timelines`)
	const cursor = f.app.store.timelines.get(f.cartHistoryTimeline.key)!.at
	await f.query(`7`)
	const timelineHits = [
		...f.host.querySelectorAll<HTMLButtonElement>(`search-results button`),
	]
	expect(timelineHits.length).toBeGreaterThan(0)
	timelineHits[0].click()
	await settle()
	expect(f.host.querySelector(`[data-search-selected="true"]`)).not.toBeNull()
	expect(f.host.querySelector(`search-results`)!.textContent).toContain(
		`recorded value: 7`,
	)
	expect(f.app.store.timelines.get(f.cartHistoryTimeline.key)!.at).toBe(cursor)
	expect(f.app.getState(f.cartQuantityAtom)).toBe(7)
	await f.tab(`transactions`)
	expect(f.input().value).toBe(`cartQuantity`)
})

it(`reports stale results rather than selecting another event after culling or disposal`, async () => {
	const f = await setup()
	await f.tab(`timelines`)
	await f.query(`cartQuantity`)
	const hit = f.host.querySelector<HTMLButtonElement>(`search-results button`)!
	f.app.store.timelines.get(f.cartHistoryTimeline.key)!.history = []
	hit.click()
	await settle()
	expect(f.host.textContent).toContain(`no longer at its captured location`)
	expect(f.host.querySelector(`[data-search-selected]`)).toBeNull()
	await f.refresh()
	expect(f.host.querySelectorAll(`search-results button`)).toHaveLength(0)
	await f.query(`cartHistory`)
	f.app.disposeTimeline(f.cartHistoryTimeline)
	await settle()
	f.host.querySelector<HTMLButtonElement>(`search-results button`)!.click()
	await settle()
	expect(f.host.textContent).toContain(`no longer at its captured location`)
})

it(`retains the admitted snapshot across new outcomes, refreshes explicitly and never remounts logs to filter`, async () => {
	const f = await setup()
	const log = f.host.querySelector(`[data-testid="transaction-changeCart"]`)!
	await f.query(`88`)
	expect(f.host.querySelectorAll(`search-results button`)).toHaveLength(0)
	f.app.runTransaction(f.changeCartTransaction)(88)
	await settle()
	expect(f.host.querySelectorAll(`search-results button`)).toHaveLength(0)
	await f.refresh()
	expect(
		f.host.querySelectorAll(`search-results button`).length,
	).toBeGreaterThan(0)
	expect(f.host.querySelector(`[data-testid="transaction-changeCart"]`)).toBe(
		log,
	)
	await f.query(`changeCart`)
	f.host.querySelector<HTMLButtonElement>(`search-results button`)!.click()
	await settle()
	expect(f.host.querySelector(`[data-search-selected]`)).toBe(log)
	const panel = f.host.querySelector<HTMLElement>(`debugger-panel`)!
	panel.hidden = true
	await settle()
	await f.query(`innerChange`)
	panel.hidden = false
	await settle()
	expect(f.host.textContent).toContain(`innerChange`)
	const selectedLog = f.host.querySelector(
		`[data-history-owner="${historyIdentity(f.app.store.transactions.get(f.changeCartTransaction.key)!)}"]`,
	)
	expect(selectedLog).toBe(log)
})

it(`selects and expands hostile recorded payloads without invoking application hooks`, async () => {
	const f = await setup(),
		trap = vi.fn(() => {
			throw new Error(`payload executed`)
		})
	const logs = f.app.store.valueMap.get(
		`🔍 Transaction Update Log (Internal)("changeCart")`,
	) as { output: unknown }[]
	logs[0].output = new Proxy(
		{},
		{ get: trap, ownKeys: trap, getPrototypeOf: trap },
	)
	await f.refresh()
	await f.query(`changeCart`)
	const hits = [
		...f.host.querySelectorAll<HTMLButtonElement>(`search-results button`),
	]
	for (const hit of hits) {
		hit.click()
		await settle()
	}
	expect(trap).not.toHaveBeenCalled()
	expect(f.host.textContent).toContain(`[opaque]`)
})

it(`waits for the owning row to mount before revealing a still-valid result`, async () => {
	const f = await setup()
	await f.query(`cartQuantity`)
	const owner = f.host.querySelector<HTMLElement>(
		`[data-testid="transaction-changeCart"]`,
	)!
	const parent = owner.parentElement!
	owner.remove()
	f.host.querySelector<HTMLButtonElement>(`search-results button`)!.click()
	await settle()
	expect(f.host.querySelector(`[data-search-selected]`)).toBeNull()
	parent.append(owner)
	await settle()
	expect(f.host.querySelector(`[data-search-selected]`)).not.toBeNull()
})

it(`ignores navigation into stale result rows while the next query is preparing`, async () => {
	const f = await setup()
	await f.query(`cartQuantity`)
	const input = f.input()
	input.focus()
	input.value = `changeCart`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	await f.key(input, `ArrowDown`)
	expect(document.activeElement).toBe(input)
})
