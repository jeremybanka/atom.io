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
