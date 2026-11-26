import { render } from "@atom.io/spa"
import { Silo } from "atom.io"
import { expect, it, vi } from "vitest"

import { EventView } from "../src/EventView.tsx"
import type { RecordedEvent } from "../src/history-event.ts"
import {
	changedRecordField,
	describeOutcomeValue,
	historyCollectionChanges,
	historySnapshotShape,
} from "../src/history-value.ts"
import { historyValuePair } from "../src/history-value-pair.ts"
import { useTools } from "../src/store.ts"

it(`retains literal escapes and meaningful differences in value previews`, () => {
	const changedWords = historyValuePair(
		`Leave the coffee beans at the side door. The front intercom is out of order.`,
		`Leave the coffee beans inside the blue parcel box next to the side door. Call when you arrive.`,
	)!
	expect(changedWords.before.preview).toContain(`beans at the side door`)
	expect(changedWords.after.preview).toContain(
		`beans inside the blue parcel box`,
	)
	expect(historyValuePair(`x`.repeat(48), `short`)?.after.preview).toBe(
		`"short"`,
	)
	expect(historyValuePair(`short`, `text`)).toBeUndefined()
	expect(historyValuePair(`before`, 1)).toBeUndefined()
	expect(historyValuePair(`Say "hello"`, `first\nsecond`)?.after.preview).toBe(
		`"first\\nsecond"`,
	)
	expect(historyValuePair(`before`, `with\ttab`)?.after.preview).toBe(
		`"with\\ttab"`,
	)
	expect(historyValuePair(1n, 2n)).toBeUndefined()
	expect(historyValuePair(1n, 2)).toBeUndefined()
	expect(
		historyValuePair(9007199254740993n, 9007199254740994n)?.after.preview,
	).toBe(`9007199254740994n`)
	expect(historyValuePair(10n ** 50n, 10n ** 50n + 1n)?.after.preview).toMatch(
		/…0+1n$/,
	)
})

it(`shows calendar, clock, and type changes without invoking payload methods`, () => {
	const day = new Date(`2026-11-25T12:00:00Z`)
	const tomorrow = new Date(`2026-11-26T12:00:00Z`)
	const later = new Date(`2026-11-25T13:00:00Z`)
	expect(historyValuePair(day, tomorrow)?.after.preview).toBe(`2026-11-26`)
	expect(historyValuePair(day, later)?.after.preview).toBe(
		`2026-11-25T13:00:00.000Z`,
	)
	expect(historyValuePair(new Date(NaN), day)?.before.preview).toBe(`Invalid`)
	expect(historyValuePair(new Proxy(day, {}), day)).toBeUndefined()
	expect(historyValuePair(day, null)).toBeUndefined()
	expect(historyValuePair(null, [1])?.before.description).toBe(`null`)
	expect(historyValuePair([1], null)?.after.description).toBe(`null`)
	expect(historyValuePair([1], false)?.after.description).toBe(`boolean`)
	expect(historyValuePair([1], { count: 1 })?.after.description).toBe(`Object`)
	expect(
		historyValuePair(new Map([[1, 2]]), new Set([1]))?.before.description,
	).toBe(`Map · size 1`)
	expect(historySnapshotShape(new Set([1]))?.description).toBe(`Set · size 1`)
	expect(
		describeOutcomeValue(
			new Map([
				[1, 2],
				[3, 4],
			]),
			true,
			true,
		).text,
	).toContain(`\n  3: 4\n`)
	expect(
		describeOutcomeValue({ a: 1, "bag size": 2 }, true, true).text,
	).toContain(`\n  "bag size": 2\n`)
})

it(`summarizes one changed record field and keeps absent fields explicit`, () => {
	const key = Symbol(`field`)
	expect(changedRecordField({ n: 1 }, { n: 2 })).toEqual({
		label: `n`,
		before: `1`,
		after: `2`,
	})
	expect(changedRecordField({}, { [key]: 1 })).toEqual({
		label: `Symbol(field)`,
		before: `<absent>`,
		after: `1`,
	})
	expect(changedRecordField({ "bean origin": `Kenya` }, {})?.after).toBe(
		`<absent>`,
	)
	expect(changedRecordField({ n: 1, m: 2 }, { n: 3, m: 4 })).toBeUndefined()
	expect(changedRecordField({ n: 1 }, 2)).toBeUndefined()
	const many = Object.fromEntries(
		Array.from({ length: 33 }, (_, index) => [index, index]),
	)
	expect(changedRecordField(many, {})).toBeUndefined()
	expect(changedRecordField({}, many)).toBeUndefined()
	expect(
		changedRecordField(
			new Proxy(
				{},
				{
					ownKeys() {
						throw new Error(`private`)
					},
				},
			),
			{},
		),
	).toBeUndefined()
})

it(`preserves holes and falls back to index comparisons when a splice also edits values`, () => {
	const sparse: string[] = Array(3)
	sparse[1] = `coffee`
	const shorter = sparse.slice(1)
	expect(
		historyCollectionChanges(sparse, shorter)?.entries[0]?.beforeLabel,
	).toBeUndefined()
	expect(
		historyCollectionChanges([1, 2], [9, 8, 7])?.entries.map(
			(row) => row.changed,
		),
	).toEqual([true, true, true])
})

it(`keeps reference numbers stable on reordered object Map keys and reports bounded scans`, () => {
	const beans = { code: `a` },
		filters = { code: `b` }
	const previous = new Map([
		[beans, 1],
		[filters, 2],
	])
	const next = new Map([
		[filters, 2],
		[beans, 1],
	])
	expect(historyCollectionChanges(previous, next)).toMatchObject({
		objectKeys: true,
		orderChanged: true,
		entries: [
			{ beforeLabel: `#1 {"code": "a"}`, afterLabel: `#2 {"code": "b"}` },
			{ beforeLabel: `#2 {"code": "b"}`, afterLabel: `#1 {"code": "a"}` },
		],
	})
	const large = new Map(
		Array.from({ length: 4100 }, (_, index) => [index, index]),
	)
	expect(historyCollectionChanges(large, new Map(large))).toMatchObject({
		comparisonLimited: true,
		truncated: true,
	})
})

function renderWrites(
	writes: ReadonlyArray<readonly [string, unknown, unknown]>,
	params: unknown[] = [],
	output?: unknown,
) {
	const app = new Silo({
		name: `compare-outcomes`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const saveTransaction = app.transaction({ key: `save`, do: () => {} })
	const event: RecordedEvent = {
		type: `transaction_outcome`,
		token: saveTransaction,
		id: `save`,
		timestamp: 1,
		params,
		output,
		subEvents: writes.map(([key, oldValue, newValue]) => ({
			type: `atom_update`,
			token: app.atom<unknown>({ key, default: null }),
			timestamp: 1,
			update: { oldValue, newValue },
		})),
	}
	const host = document.createElement(`div`)
	document.body.append(host)
	const view = render(
		() => (
			<EventView
				tools={useTools(app.store)}
				event={event}
				index={0}
				ecology={{
					owner: `transaction:save`,
					hovered: undefined,
					selected: undefined,
				}}
				compact
			/>
		),
		host,
		{ store: app.store },
	)
	return {
		host,
		open: async () => {
			await click(host.querySelector(`button[aria-label="Expand outcome 1"]`)!)
		},
		dispose: () => {
			view.dispose()
			host.remove()
		},
	}
}

async function click(button: HTMLButtonElement): Promise<void> {
	button.click()
	await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

const collection = (host: HTMLElement, key: string) =>
	host.querySelector<HTMLElement>(
		`outcome-collection-change:has(strong[title="${key}"])`,
	)!

it(`renders shifted indices, changed-field summaries, object references and metadata`, async () => {
	const cycle = { n: 1, self: undefined as unknown }
	cycle.self = cycle
	const objectKey = { code: `a` }
	const reorderedBefore = new Set([`Kenya`, `Rwanda`])
	const reorderedAfter = new Set([`Rwanda`, `Kenya`])
	const view = renderWrites(
		[
			[
				`splice`,
				[`coffee`, `mug`, `kettle`],
				[`coffee`, `filters`, `mug`, `kettle`],
			],
			[`record`, [{ id: 2, quantity: 1 }], [{ id: 2, quantity: 2 }]],
			[
				`profile`,
				{ profile: { city: `Seattle`, color: `blue` } },
				{ profile: { city: `Tacoma`, color: `green` } },
			],
			[`short`, { mixed: [[[]]] }, { mixed: `plain` }],
			[`cycle`, [cycle], [cycle]],
			[
				`map`,
				new Map([[objectKey, `in stock`]]),
				new Map([[objectKey, `low stock`]]),
			],
			[`set`, reorderedBefore, reorderedAfter],
			[`empty`, {}, {}],
			[`pair`, [`coffee`], { item: `coffee` }],
		],
		[`order-123`],
		{ confirmed: true, itemCount: 2 },
	)
	try {
		await view.open()
		const { host } = view
		expect(
			collection(host, `splice`).querySelectorAll(`[data-snapshot-diff]`),
		).toHaveLength(1)
		expect(collection(host, `record`).textContent).toContain(`quantity: 2`)
		const profile = collection(host, `profile`)
		await click(
			profile.querySelector(`button[aria-label="Show full new value"]`)!,
		)
		expect(
			profile.querySelector(`[data-snapshot-side="after"] outcome-value button`)
				?.textContent,
		).toContain(`city: "Tacoma"`)
		expect(
			collection(host, `cycle`).querySelectorAll(`[data-circular]`),
		).toHaveLength(2)
		await click(
			collection(host, `cycle`).querySelector(
				`button[aria-label="Show full previous value"]`,
			)!,
		)
		expect(collection(host, `cycle`).textContent).toContain(`[circular]`)
		expect(collection(host, `map`).textContent).toContain(
			`# identifies each key object`,
		)
		expect(collection(host, `set`).textContent).toContain(
			`Iteration order changed`,
		)
		expect(host.querySelector(`[data-metadata-block]`)?.textContent).toContain(
			`"itemCount": 2`,
		)
		const pair = host.querySelector(`outcome-value-pair`)!
		await click(pair.querySelector(`button`)!)
		expect(pair.textContent).toContain(`{item: "coffee"}`)
	} finally {
		view.dispose()
	}
})

it(`explains missing and retained indexes in large comparisons`, async () => {
	const before = Array.from({ length: 5000 }, (_, index) => index)
	const many = before.map((value) => (value < 4 ? value + 100 : value))
	const stock = new Map(Array.from({ length: 60 }, (_, index) => [index, index]))
	const adjusted = new Map(
		[...stock].map(([key, value]) => [key, key >= 40 ? -value : value]),
	)
	const view = renderWrites([
		[`tail`, before, [...before, 5000]],
		[`one`, Array(2), Array(1)],
		[`range`, Array(15), Array(5)],
		[`many`, before, many],
		[`inventory`, stock, adjusted],
	])
	try {
		await view.open()
		const { host } = view
		expect(collection(host, `tail`).textContent).toContain(`4999499949994999`)
		expect(collection(host, `one`).textContent).toContain(`Index 1 removed`)
		expect(collection(host, `range`).textContent).toContain(
			`Indexes 05–14 removed`,
		)
		expect(collection(host, `many`).textContent).toContain(
			`4 edited indexes found`,
		)
		expect(collection(host, `inventory`).textContent).toContain(
			`20 edited entries`,
		)
	} finally {
		view.dispose()
	}
})

it(`scrolls to edits on disclosure and cycles through the updates`, async () => {
	const before = Array.from({ length: 15 }, (_, index) => index)
	const after = before.map((value) =>
		value === 7 || value === 12 ? -value : value,
	)
	const view = renderWrites([
		[`edits`, before, after],
		[`unchanged`, before, [...before]],
	])
	const frames: FrameRequestCallback[] = []
	const requestFrame = vi
		.spyOn(window, `requestAnimationFrame`)
		.mockImplementation((callback) => {
			frames.push(callback)
			return frames.length
		})
	try {
		await view.open()
		const comparison = collection(view.host, `edits`)
		const pane = comparison.querySelector<HTMLElement>(`snapshot-comparison`)!
		let scrollTop = 0
		Object.defineProperties(pane, {
			clientHeight: { value: 120 },
			scrollHeight: { value: 260 },
			scrollTop: {
				get: () => scrollTop,
				set: (requested: number) => {
					scrollTop = Math.max(0, Math.min(140, requested))
				},
			},
		})
		vi.spyOn(pane, `getBoundingClientRect`).mockReturnValue(
			new DOMRect(0, 0, 200, 120),
		)
		vi.spyOn(
			pane.querySelector(`thead`)!,
			`getBoundingClientRect`,
		).mockReturnValue(new DOMRect(0, 0, 200, 20))
		await click(comparison.querySelector(`button[aria-expanded="false"]`)!)
		const [first, later] = Array.from(
			pane.querySelectorAll(`tr[data-snapshot-changed]`),
		)
		vi.spyOn(first, `getBoundingClientRect`).mockImplementation(
			() => new DOMRect(0, 120 - pane.scrollTop, 200, 20),
		)
		vi.spyOn(later, `getBoundingClientRect`).mockImplementation(
			() => new DOMRect(0, 200 - pane.scrollTop, 200, 20),
		)
		frames.shift()!(0)
		expect(pane.scrollTop).toBe(100)
		const nextEdit = Array.from(comparison.querySelectorAll(`button`)).find(
			(button) => button.textContent === `Next edit`,
		)!
		await click(nextEdit)
		expect(pane.scrollTop).toBe(140)
		await click(nextEdit)
		expect(pane.scrollTop).toBe(100)
		const unchanged = collection(view.host, `unchanged`)
		const toggle = unchanged.querySelector<HTMLButtonElement>(
			`button[aria-expanded="false"]`,
		)!
		await click(toggle)
		frames.shift()!(0)
		await click(toggle)
		await click(toggle)
		unchanged.remove()
		expect(() => {
			frames.shift()!(0)
		}).not.toThrow()
	} finally {
		view.dispose()
		requestFrame.mockRestore()
	}
})
