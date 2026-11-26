import { render } from "@atom.io/spa"
import { Silo } from "atom.io"
import { expect, it } from "vitest"

import { EventView } from "../src/EventView.tsx"
import { historyWriteCount, type RecordedEvent } from "../src/history-event.ts"
import { useTools } from "../src/store.ts"

it(`renders derivedSelector children, opaque updates and bounded recursive outcomes without payload serialization`, () => {
	const app = new Silo({
		name: `event-previews`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const valueAtom = app.atom<unknown>({ key: `value`, default: null })
	const nestedTransaction = app.transaction<() => unknown>({
		key: `nested`,
		do: () => null,
	})
	const outcome: RecordedEvent = {
		type: `transaction_outcome`,
		token: nestedTransaction,
		id: `one`,
		timestamp: 1,
		params: [{}, ...Array.from({ length: 16 }, () => 1)],
		output: () => 0,
		subEvents: [],
	}
	outcome.subEvents.push(outcome)
	const derivedSelector = app.selector<number>({ key: `derived`, get: () => 0 })
	const events: RecordedEvent[] = [
		outcome,
		{
			type: `selector_update`,
			token: derivedSelector,
			timestamp: 2,
			subEvents: [
				{
					type: `atom_update`,
					token: valueAtom,
					timestamp: 2,
					update: {
						oldValue: {
							toJSON: () => {
								throw new Error(`not passive`)
							},
						},
						newValue: { x: 1 },
					},
				},
			],
		},
		{
			type: `molecule_creation`,
			key: [`opaque`],
			provenance: `x`.repeat(2000),
			timestamp: 3,
		},
	]
	const host = document.createElement(`div`)
	const root = render(
		() => {
			const tools = useTools(app.store)
			return (
				<>
					{events.map((event, index) => (
						<EventView tools={tools} event={event} index={index} />
					))}
				</>
			)
		},
		host,
		{ store: app.store },
	)
	expect(host.textContent).toContain(`Nested events omitted`)
	expect(host.textContent).toContain(`selector_update`)
	expect(host.querySelector(`del`)!.textContent).toBe(`[opaque]`)
	expect(host.querySelector(`ins`)!.textContent).toBe(`[opaque]`)
	expect(host.textContent).toContain(`"key":"[opaque]"`)
	expect(host.textContent).toContain(`params: [[opaque],`)
	expect(host.textContent).toContain(`,…]`)
	root.dispose()
})

it(`shows compact outcome writes before optional metadata and expands long previews on demand`, async () => {
	const app = new Silo({
		name: `outcome-previews`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = app.atom<number>({ key: `count`, default: 0 })
	const noteAtom = app.atom<unknown>({ key: `note`, default: null })
	const saveTransaction = app.transaction<() => unknown>({
		key: `save`,
		do: () => null,
	})
	const nestedTransaction = app.transaction<() => unknown>({
		key: `nested`,
		do: () => null,
	})
	const text = `payload `.repeat(150).trim()
	const unread = new Proxy(
		{},
		{
			ownKeys: () => {
				throw new Error(`not passive`)
			},
		},
	)
	const nested = {
		type: `transaction_outcome` as const,
		token: nestedTransaction,
		id: `nested`,
		timestamp: 1,
		params: [],
		output: undefined,
		subEvents: [
			{
				type: `atom_update` as const,
				token: noteAtom,
				timestamp: 1,
				update: { oldValue: unread, newValue: text },
			},
		],
	}
	const outcome = {
		type: `transaction_outcome` as const,
		token: saveTransaction,
		id: `save`,
		timestamp: 2,
		params: [unread, ...Array.from({ length: 17 }, () => `x`), text],
		output: text,
		subEvents: [
			{
				type: `atom_update` as const,
				token: countAtom,
				timestamp: 2,
				update: { oldValue: 0, newValue: 1 },
			},
			nested,
			{
				type: `atom_disposal` as const,
				token: countAtom,
				timestamp: 2,
				value: 1,
			},
		],
	}
	const empty = {
		...outcome,
		id: `empty`,
		params: [],
		output: undefined,
		subEvents: [],
	}
	const result = { ...empty, id: `result`, output: false }
	const args = { ...empty, id: `args`, params: [0] }
	const events = [outcome, empty, result, args]
	const host = document.createElement(`div`)
	const root = render(
		() => {
			const tools = useTools(app.store)
			return (
				<>
					{events.map((event, index) => (
						<EventView
							tools={tools}
							event={event}
							index={index}
							ecology={{
								owner: `transaction:save`,
								hovered: undefined,
								selected: undefined,
							}}
							compact
						/>
					))}
				</>
			)
		},
		host,
		{ store: app.store },
	)
	try {
		const click = async (scope: Element, label: string) => {
			scope
				.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
				.click()
			await new Promise<void>((resolve) => setTimeout(resolve, 0))
		}
		const [first, second, third, fourth] = host.children
		expect(first.textContent).toBe(`Outcome 12 writes`)
		expect(second.textContent).toBe(`Outcome 20 writes`)
		expect(second.querySelector(`button[aria-expanded]:disabled`)).not.toBeNull()
		await click(first, `Expand outcome 1`)
		const impact = first.querySelector(`event-impact`)!
		expect(impact.nextElementSibling?.matches(`[data-outcome-metadata]`)).toBe(
			true,
		)
		const [write, group, record] = impact.children
		expect(write.textContent).toBe(`count01`)
		expect(write.querySelector(`button`)).toBeNull()
		expect(group.textContent).toBe(`nested1 write`)
		await click(group, `Expand event`)
		const note = group.querySelector(`p[data-compact-write]`)!
		expect(note.querySelector(`strong`)?.textContent).toBe(`note`)
		expect(note.querySelector(`del`)?.textContent).toBe(`[opaque]`)
		expect(note.textContent).not.toContain(text)
		await click(note, `Show full new value`)
		expect(note.querySelector(`ins`)?.textContent).toBe(JSON.stringify(text))
		await click(note, `Collapse new value`)
		expect(note.textContent).not.toContain(text)
		await click(record, `Expand event`)
		expect(record.textContent).toContain(`atom disposal`)
		expect(record.querySelector(`code`)?.textContent).toContain(`"value":1`)
		const metadata = impact.nextElementSibling!
		await click(metadata, `Show full arguments`)
		expect(metadata.textContent).toContain(`[[opaque],"x",`)
		expect(metadata.textContent).toContain(`${JSON.stringify(text)}]`)
		await click(metadata, `Show full result`)
		expect(
			metadata.querySelector(`button[aria-label="Collapse result"]`)
				?.textContent,
		).toBe(JSON.stringify(text))
		await click(third, `Expand outcome 3`)
		expect(third.querySelector(`[data-outcome-metadata]`)?.textContent).toBe(
			`Resultfalse`,
		)
		await click(fourth, `Expand outcome 4`)
		expect(fourth.querySelector(`[data-outcome-metadata]`)?.textContent).toBe(
			`Args[0]`,
		)
	} finally {
		root.dispose()
	}
	const cyclic: RecordedEvent = { ...outcome, subEvents: [] }
	cyclic.subEvents.push(cyclic, nested)
	expect(historyWriteCount([cyclic])).toBe(1)
})

it(`aligns collection snapshots with unchanged context and discloses larger samples`, async () => {
	const app = new Silo({
		name: `collection-changes`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const saveTransaction = app.transaction({ key: `save`, do: () => {} })
	const produce: string[] = Array.from({ length: 110 }, () => `stock`)
	const revised = [...produce]
	revised[7] = `tomato`
	revised[100] = `eggplant`
	const sparse: string[] = Array(110)
	sparse[0] = `stock`
	sparse[7] = `tomato`
	sparse[100] = `eggplant`
	const updates = [
		[`cartItems`, [], [`coffee-beans`]],
		[`record`, { removed: true, changed: 0 }, { added: null, changed: 1 }],
		[
			`market`,
			new Map([[`same`, 1]]),
			new Map([
				[`same`, 1],
				[`fresh`, 2],
			]),
		],
		[`members`, new Set([`one`]), new Set([`two`])],
		[`large`, [], Array.from({ length: 64 }, (_, index) => index)],
		[`same`, [1], [1]],
		[`empty`, [], []],
		[`late`, [0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5, 6]],
		[`produce`, produce, revised],
		[`sampled`, Array(5000), Array(5001)],
		[`extended`, [`stock`], sparse],
		[`shortened`, sparse, [`stock`]],
		[`raw`, 0, { cart: [`coffee-beans`] }],
		[`truncated`, 0, [[[]]]],
	] as const
	const event: RecordedEvent = {
		type: `transaction_outcome`,
		token: saveTransaction,
		id: `save`,
		timestamp: 1,
		params: [],
		output: undefined,
		subEvents: updates.map(([key, oldValue, newValue]) => ({
			type: `atom_update`,
			token: app.atom<unknown>({ key, default: 0 }),
			timestamp: 1,
			update: { oldValue, newValue },
		})),
	}
	const host = document.createElement(`div`)
	const root = render(
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
	try {
		const click = async (button: HTMLButtonElement) => {
			button.click()
			await new Promise<void>((resolve) => setTimeout(resolve, 0))
		}
		await click(
			host.querySelector<HTMLButtonElement>(
				`button[aria-label="Expand outcome 1"]`,
			)!,
		)
		const [
			cart,
			record,
			market,
			members,
			large,
			same,
			empty,
			late,
			distant,
			sampled,
			extended,
			shortened,
		] = host.querySelectorAll(`outcome-collection-change`)
		expect(
			cart.querySelector(`[data-collection-summary] small`)?.textContent,
		).toBe(`Array`)
		const headings = (view: Element) =>
			[...view.querySelectorAll(`th`)].map((cell) => cell.textContent)
		expect(headings(cart)).toEqual([`Beforelength 0`, `Afterlength 1`])
		expect(
			cart.querySelector(
				`[data-snapshot-punctuation] [data-snapshot-side="before"]`,
			)?.textContent,
		).toBe(`[]`)
		expect(cart.querySelector(`[data-snapshot-diff="after"]`)?.textContent).toBe(
			`0"coffee-beans"`,
		)
		expect(cart.querySelector(`[data-snapshot-diff="before"]`)).toBeNull()
		expect(
			record.querySelector(`[data-collection-summary] small`)?.textContent,
		).toBe(`Object`)
		expect(
			record.querySelector(`[data-snapshot-diff="before"] outcome-value`)
				?.textContent,
		).toBe(`true`)
		const changed = record.querySelector(`tr:has(code[title="changed"])`)!
		expect(
			[...changed.querySelectorAll(`td[data-snapshot-diff] outcome-value`)].map(
				(cell) => cell.textContent,
			),
		).toEqual([`0`, `1`])
		expect(headings(market)).toEqual([`Beforesize 1`, `Aftersize 2`])
		expect(headings(members)).toEqual([`Beforesize 1`, `Aftersize 1`])
		const shared = market.querySelector(`tr:has(code[title='"same"'])`)!
		expect(
			[...shared.querySelectorAll(`outcome-value`)].map(
				(cell) => cell.textContent,
			),
		).toEqual([`1`, `1`])
		expect(shared.querySelector(`[data-snapshot-diff]`)).toBeNull()
		expect(same.querySelector(`[data-snapshot-entry]`)?.textContent).toBe(`0101`)
		expect(same.querySelector(`[data-snapshot-diff]`)).toBeNull()
		expect(
			[...empty.querySelectorAll(`tbody td`)].map((cell) => cell.textContent),
		).toEqual([`[]`, `[]`])
		expect(late.querySelectorAll(`[data-snapshot-entry]`)).toHaveLength(1)
		expect(
			late.querySelector(`[data-snapshot-diff="after"] code`)?.textContent,
		).toBe(`6`)
		expect(
			[...late.querySelectorAll(`[data-snapshot-gap] code`)].map(
				(item) => item.textContent,
			),
		).toContain(`…`)
		const afterRows = [
			...distant.querySelectorAll(
				`tbody tr:not([data-snapshot-punctuation]) [data-snapshot-side="after"]`,
			),
		]
		expect(afterRows.map((entry) => entry.textContent)).toEqual([
			`…`,
			`007"tomato"`,
			`…`,
			`100"eggplant"`,
			`…`,
		])
		const showContext =
			distant.querySelector<HTMLButtonElement>(`:scope > button`)!
		expect(showContext.textContent).toBe(`Show 30 more rows`)
		await click(showContext)
		expect(distant.querySelectorAll(`[data-snapshot-entry]`)).toHaveLength(32)
		expect(
			[
				...distant.querySelectorAll(
					`[data-snapshot-diff="after"] > snapshot-entry > code`,
				),
			].map((entry) => entry.textContent),
		).toEqual([`007`, `100`])
		expect(
			sampled.querySelector(`[data-collection-note]`)?.textContent,
		).toContain(`comparison sampled`)
		const gaps = (view: Element, side: string) =>
			[
				...view.querySelectorAll(
					`[data-snapshot-gap] [data-snapshot-side="${side}"]`,
				),
			].map((entry) => entry.textContent)
		expect(gaps(extended, `before`)).toEqual([``, ``, ``])
		expect(
			extended.querySelector(
				`[data-snapshot-entry] [data-snapshot-side="before"]`,
			)?.textContent,
		).toBe(`000"stock"`)
		expect(gaps(shortened, `after`)).toEqual([`…`, ``, ``])
		expect(large.querySelector(`[data-collection-note]`)?.textContent).toContain(
			`sampled entries`,
		)
		expect(large.querySelectorAll(`[data-snapshot-entry]`)).toHaveLength(3)
		const disclosure = large.querySelector<HTMLButtonElement>(`:scope > button`)!
		expect(disclosure.textContent).toBe(`Show 29 more rows`)
		await click(disclosure)
		expect(large.querySelectorAll(`[data-snapshot-entry]`)).toHaveLength(32)
		expect(disclosure.textContent).toBe(`Show fewer rows`)
		await click(disclosure)
		expect(large.querySelectorAll(`[data-snapshot-entry]`)).toHaveLength(3)
		const raw = host.querySelector<HTMLButtonElement>(
			`p:has(> strong[title="raw"]) button[aria-label="Show full new value"]`,
		)!
		await click(raw)
		expect(raw.textContent).toBe(`{"cart": ["coffee-beans"]}`)
		const truncated = host.querySelector<HTMLButtonElement>(
			`p:has(> strong[title="truncated"]) button[aria-label="Show full new value"]`,
		)!
		expect(truncated.textContent).toBe(`[[Array(…)]]`)
		await click(truncated)
		expect(truncated.textContent).toBe(`[[[]]]`)
	} finally {
		root.dispose()
	}
})
