import { Silo } from "atom.io"
import { isReservedIntrospectionKey } from "atom.io/internal"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { createSearchContext } from "../src/search-controller.ts"
import { mountSearchFixture } from "./fixtures/views.tsx"

let dispose = () => {}
beforeEach(() => {
	vi.useFakeTimers()
	let clock = 0
	// Force a real scheduled boundary after a few documents, independent of machine speed.
	vi.spyOn(performance, `now`).mockImplementation(() => ++clock)
})
afterEach(() => {
	dispose()
	document.body.replaceChildren()
	vi.restoreAllMocks()
	vi.useRealTimers()
})
function fixture() {
	const silo = new Silo({
		name: `search-lifecycle`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	for (let i = 0; i < 100; i++) {
		const key = `record${i}`
		silo.atom<string>({ key, default: `` })
		silo.store.valueMap.set(key, `before`)
	}
	const panel = document.createElement(`main`)
	document.body.append(panel)
	const context = createSearchContext()
	const mounted = mountSearchFixture(panel, silo.store, context)
	const host = mounted.host
	dispose = mounted.dispose
	const input = host.querySelector(`input`)!
	const query = (text: string) => {
		input.value = text
		input.dispatchEvent(new Event(`input`, { bubbles: true }))
	}
	const refresh = () => {
		;[...host.querySelectorAll(`button`)]
			.find((button) => button.textContent === `Refresh`)!
			.click()
	}
	const value = () =>
		context
			.index!.documents.find((doc) => doc.key === `record0`)!
			.fields.find((field) => field.kind === `value`)!.text
	return { silo, panel, host, context, input, query, refresh, value }
}

// Ported from Commander's independent probe.test.ts; these two assertions fail on e9c82df4.
it(`initial-index: typing while preparation is in flight settles with current-query hits`, async () => {
	const f = fixture()
	await vi.advanceTimersToNextTimerAsync()
	expect(f.context.index).toBeUndefined()
	f.query(`record0`)
	await vi.runAllTimersAsync()
	expect(f.host.dataset[`ready`]).toBe(`true`)
	expect(f.host.querySelector(`[data-search-id="state:record0"]`)).not.toBeNull()
	expect(
		f.host.querySelector(`search-results`)!.getAttribute(`aria-busy`),
	).toBeNull()
})

it(`refresh-index: typing during Refresh preserves the refreshed cached values`, async () => {
	const f = fixture()
	await vi.runAllTimersAsync()
	expect(f.context.index).toBeDefined()
	f.silo.store.valueMap.set(`record0`, `updated-value`)
	f.refresh()
	await vi.advanceTimersToNextTimerAsync()
	f.query(`updated-value`)
	await vi.runAllTimersAsync()
	expect(f.host.querySelector(`[data-search-id="state:record0"]`)).not.toBeNull()
	expect(f.value()).toBe(`updated-value`)
})

it(`rapid input across several initial index chunks matches only the latest query without recapturing`, async () => {
	const f = fixture()
	const read = vi.spyOn(f.silo.store.valueMap, `get`)
	for (const query of [`record1`, `record8`, `record98`]) {
		await vi.advanceTimersToNextTimerAsync()
		expect(f.context.index).toBeUndefined()
		f.query(query)
	}
	await vi.runAllTimersAsync()
	expect(
		read.mock.calls.filter(([key]) => !isReservedIntrospectionKey(key)),
	).toEqual([])
	expect(f.context.query).toBe(`record98`)
	expect(
		[...f.host.querySelectorAll<HTMLElement>(`[data-search-id]`)].map(
			(hit) => hit.dataset[`searchId`],
		),
	).toEqual([`state:record98`])
	expect(f.host.dataset[`ready`]).toBe(`true`)
})

it(`Refresh during typing supersedes both unfinished matching and older preparation, keeping results guarded`, async () => {
	const f = fixture()
	await vi.runAllTimersAsync()
	f.query(`record0`)
	await vi.runAllTimersAsync()
	const stale = f.host.querySelector<HTMLButtonElement>(
		`[data-search-id="state:record0"]`,
	)!
	f.query(`before`)
	await vi.advanceTimersToNextTimerAsync()
	f.silo.store.valueMap.set(`record0`, `first-refresh`)
	f.refresh()
	await vi.advanceTimersToNextTimerAsync()
	f.query(`first-refresh`)
	stale.click()
	expect(f.host.querySelector(`search-details`)!.textContent).toBe(``)
	expect(f.host.querySelector(`search-results`)!.getAttribute(`aria-busy`)).toBe(
		`true`,
	)
	f.silo.store.valueMap.set(`record0`, `latest-refresh`)
	f.refresh()
	const read = vi.spyOn(f.silo.store.valueMap, `get`)
	for (const query of [`before`, `record9`, `latest-refresh`]) {
		await vi.advanceTimersToNextTimerAsync()
		f.query(query)
	}
	await vi.runAllTimersAsync()
	expect(
		read.mock.calls.filter(([key]) => !isReservedIntrospectionKey(key)),
	).toEqual([])
	expect(f.value()).toBe(`latest-refresh`)
	expect(f.host.querySelectorAll(`[data-search-id]`)).toHaveLength(1)
	expect(f.host.querySelector(`[data-search-id="state:record0"]`)).not.toBeNull()
	expect(
		f.host.querySelector(`search-results`)!.getAttribute(`aria-busy`),
	).toBeNull()
})

it(`Clear and composition-end during preparation preserve the copied index and latest input`, async () => {
	const f = fixture()
	f.query(`discarded`)
	await vi.advanceTimersToNextTimerAsync()
	;[...f.host.querySelectorAll(`button`)]
		.find((button) => button.textContent === `Clear`)!
		.click()
	await vi.advanceTimersToNextTimerAsync()
	f.input.value = `record3`
	f.input.dispatchEvent(new InputEvent(`input`, { isComposing: true }))
	expect(f.context.query).toBe(``)
	f.input.dispatchEvent(new Event(`compositionend`))
	await vi.runAllTimersAsync()
	expect(f.context.query).toBe(`record3`)
	expect(f.host.dataset[`ready`]).toBe(`true`)
	expect(f.host.querySelector(`[data-search-id="state:record3"]`)).not.toBeNull()
})

it.each([`hidden`, `data-open`] as const)(
	`%s cancels pending preparation; visibility resumes Refresh rather than using its stale index`,
	async (attribute) => {
		const f = fixture()
		await vi.runAllTimersAsync()
		f.silo.store.valueMap.set(`record0`, `not-finished`)
		f.refresh()
		await vi.advanceTimersToNextTimerAsync()
		if (attribute === `hidden`) f.panel.hidden = true
		else f.panel.dataset[`open`] = `false`
		await vi.runAllTimersAsync()
		expect(f.value()).toBe(`before`)
		const read = vi.spyOn(f.silo.store.valueMap, `get`)
		f.query(`visible-value`)
		await vi.runAllTimersAsync()
		expect(
			read.mock.calls.filter(([key]) => !isReservedIntrospectionKey(key)),
		).toEqual([])
		f.silo.store.valueMap.set(`record0`, `visible-value`)
		if (attribute === `hidden`) f.panel.hidden = false
		else f.panel.dataset[`open`] = `true`
		await vi.runAllTimersAsync()
		expect(f.value()).toBe(`visible-value`)
		expect(f.host.dataset[`ready`]).toBe(`true`)
		expect(
			f.host.querySelector(`[data-search-id="state:record0"]`),
		).not.toBeNull()
	},
)

it(`disposal cancels unfinished index and match generations with no late publication`, async () => {
	const f = fixture()
	await vi.advanceTimersToNextTimerAsync()
	f.query(`record0`)
	dispose()
	expect(f.host.querySelector(`search-context-notice`)).toBeNull()
	await vi.runAllTimersAsync()
	expect(f.context.index).toBeUndefined()
	expect(f.host.querySelector(`search-controls`)).toBeNull()
	const g = fixture()
	await vi.runAllTimersAsync()
	g.query(`record0`)
	await vi.advanceTimersToNextTimerAsync()
	dispose()
	expect(g.host.querySelector(`search-context-notice`)).toBeNull()
	await vi.runAllTimersAsync()
	expect(g.host.querySelector(`search-controls`)).toBeNull()
})
