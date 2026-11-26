import { render } from "@atom.io/spa"
import { Silo } from "atom.io"
import { expect, it } from "vitest"

import type { RecordedEvent } from "../src/history-event.ts"
import { useTools } from "../src/store.ts"
import { timelineEventSummary } from "../src/timeline-event-summary.ts"
import { TimelineHistory } from "../src/TimelineHistory.tsx"

it(`summarizes short writes, collection changes, and bounded previews`, () => {
	const silo = new Silo({
		name: `timeline-preview`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const noteAtom = silo.atom<unknown>({ key: `note`, default: undefined })
	const write = (oldValue: unknown, newValue: unknown) => ({
		type: `atom_update` as const,
		token: noteAtom,
		timestamp: 1,
		update: { oldValue, newValue },
	})
	const check = (before: unknown, after: unknown, expected: unknown) => {
		expect(timelineEventSummary(write(before, after), undefined)).toEqual(
			expected,
		)
	}
	check(``, `a`, { before: `""`, after: `"a"` })
	check(-0, 1, { before: `-0`, after: `1` })
	check(`a`.repeat(24), `b`, { label: `length`, before: `24`, after: `1` })
	check(`a`.repeat(13), `b`.repeat(13), `Text changed`)
	check(`\n`.repeat(12), `b`, { label: `length`, before: `12`, after: `1` })
	check(1n, 2n, `Value changed`)
	check([1], {}, { before: `Array`, after: `Object` })
	check(true, [], { before: `true`, after: `Array` })
	check([], null, { before: `Array`, after: `null` })
	check([], () => {}, { before: `Array`, after: `function` })
	check(Symbol(), [], { before: `symbol`, after: `Array` })
	check([], [1], { label: `length`, before: `0`, after: `1` })
	check(new Set(), new Set([1]), { label: `size`, before: `0`, after: `1` })
	check([1, 2], [1, 3], `Index 1 changed`)
	check([1, 2], [3, 4], `2 indexes changed`)
	check([1], [1], `No visible change`)
	check(Array(4000), Array(4000), `Array changed`)
	check({ keep: 1 }, { keep: 1, add: 2 }, `+ add`)
	check({ keep: 1, remove: 2 }, { keep: 1 }, `− remove`)
	check({ count: 1 }, { count: 2 }, `count changed`)
	check({ a: 1, b: 2 }, { a: 3, b: 4 }, `2 fields changed`)
	check(new Set([1, 2]), new Set([2, 1]), `Order changed`)
	check(new Set([1]), new Set([2]), `2 entries changed`)
	check(new Map([[1, 2]]), new Map([[1, 3]]), `1 entry changed`)
	let reads = 0
	const guarded = new Proxy(
		{},
		{
			getPrototypeOf() {
				if (reads++ > 0) throw Error(`private`)
				return Object.prototype
			},
		},
	)
	check(guarded, {}, `Object changed`)

	const saveSelector = silo.selector<null>({ key: `save`, get: () => null })
	const group = (child: ReturnType<typeof write>): RecordedEvent => ({
		type: `selector_update`,
		token: saveSelector,
		timestamp: 2,
		subEvents: [child],
	})
	expect(timelineEventSummary(group(write(1, 2)), 1)).toEqual({
		label: `note`,
		before: `1`,
		after: `2`,
	})
	expect(timelineEventSummary(group(write([], [1])), 1)).toEqual({
		label: `note · length`,
		before: `0`,
		after: `1`,
	})
	expect(timelineEventSummary(group(write([1], [2])), 1)).toBe(
		`note · Index 0 changed`,
	)
	expect(
		timelineEventSummary(
			{
				type: `atom_creation`,
				token: noteAtom,
				timestamp: 1,
				value: () => {},
			},
			undefined,
		),
	).toBe(`Value recorded`)
})

it(`shows lifecycle values, grouped writes, and the checkpoint range at the cursor`, async () => {
	const silo = new Silo({
		name: `timeline-history`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const itemAtom = silo.atom<unknown>({ key: `item`, default: undefined })
	const statusSelector = silo.selector<number>({ key: `status`, get: () => 0 })
	const groupTransaction = silo.transaction({ key: `group`, do: () => {} })
	const prunedOutcome: RecordedEvent = {
		type: `transaction_outcome`,
		token: groupTransaction,
		timestamp: 6,
		id: `pruned`,
		timelineOutcomeSequence: 2,
		subEvents: [],
		params: [],
		output: undefined,
	}
	const host = document.createElement(`div`)
	const view = render(
		() => (
			<TimelineHistory
				tools={useTools(silo.store)}
				timelineKey="items"
				timeline={{
					at: 2,
					history: [
						{
							type: `atom_creation`,
							token: itemAtom,
							timestamp: 1,
							value: { sku: `beans` },
							checkpoint: true,
						},
						{
							type: `selector_update`,
							token: statusSelector,
							timestamp: 2,
							subEvents: [
								{
									type: `atom_creation`,
									token: itemAtom,
									timestamp: 2,
									value: undefined,
								},
								{
									type: `atom_update`,
									token: itemAtom,
									timestamp: 2,
									update: { oldValue: false, newValue: true },
								},
							],
						},
						{ type: `atom_disposal`, token: itemAtom, timestamp: 3 },
						{
							type: `atom_disposal`,
							token: itemAtom,
							timestamp: 4,
							value: `beans`,
						},
						{
							type: `transaction_outcome`,
							token: groupTransaction,
							timestamp: 5,
							id: `old`,
							subEvents: [
								{ type: `atom_disposal`, token: itemAtom, timestamp: 5 },
							],
							params: [],
							output: undefined,
						},
						prunedOutcome,
						{
							type: `atom_update`,
							token: itemAtom,
							timestamp: 7,
							update: { oldValue: ``, newValue: `a` },
						},
					],
				}}
			/>
		),
		host,
		{ store: silo.store },
	)
	const click = async (label: string) => {
		host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click()
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
	}
	try {
		const rows = Array.from(
			host.querySelectorAll(`event-view[data-timeline-event]`),
		)
		expect(host.querySelectorAll(`[data-undo-range]`)).toHaveLength(2)
		expect(host.querySelector(`[data-cursor]`)?.nextElementSibling).toBe(rows[2])
		expect(host.querySelectorAll(`[data-redo-next]`)).toHaveLength(1)
		expect(
			rows[2].querySelector(`button[aria-expanded]:disabled`),
		).not.toBeNull()
		expect(rows[2].textContent).toContain(`Disposed`)
		expect(rows[0].querySelector(`[data-timeline-summary]`)?.textContent).toBe(
			`Object`,
		)
		expect(rows[2].querySelector(`[data-timeline-summary]`)).toBeNull()
		expect(rows[3].querySelector(`[data-timeline-summary]`)?.textContent).toBe(
			`"beans"`,
		)
		await click(`Expand 1 · item`)
		expect(rows[0].querySelector(`[data-lifecycle]`)?.textContent).toBe(
			`Value{"sku": "beans"}`,
		)
		await click(`Expand 2 · status`)
		expect(rows[1].querySelector(`[data-write-count]`)?.textContent).toBe(
			`1 write`,
		)
		expect(rows[1].querySelector(`[data-lifecycle]`)?.textContent).toBe(
			`itemCreatedundefined`,
		)
		expect(rows[1].querySelector(`[data-compact-write]`)?.textContent).toBe(
			`itemfalsetrue`,
		)
		await click(`Expand 4 · item`)
		expect(rows[3].querySelector(`[data-lifecycle]`)?.textContent).toBe(
			`Value"beans"`,
		)
		await click(`Expand 5 · group`)
		expect(rows[4].querySelector(`[data-lifecycle]`)?.textContent).toBe(
			`itemDisposed`,
		)
		for (const row of rows.slice(4, 6)) {
			expect(row.querySelector(`[data-timeline-kind]`)?.textContent).toBe(
				`Transaction outcome`,
			)
			expect(row.querySelector(`button[data-outcome-link]`)).toBeNull()
		}
		const summary = rows[6].querySelector(`[data-timeline-summary]`)!
		expect(summary.querySelector(`del`)?.textContent).toBe(`""`)
		expect(summary.querySelector(`ins`)?.textContent).toBe(`"a"`)
	} finally {
		view.dispose()
	}
})
