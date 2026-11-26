import { render } from "@atom.io/spa"
import { Silo } from "atom.io"
import { expect, it } from "vitest"

import type { RecordedEvent } from "../src/history-event.ts"
import { useTools } from "../src/store.ts"
import { TimelineHistory } from "../src/TimelineHistory.tsx"

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
		for (const row of rows.slice(4)) {
			expect(row.querySelector(`[data-timeline-kind]`)?.textContent).toBe(
				`Transaction outcome`,
			)
			expect(row.querySelector(`button[data-outcome-link]`)).toBeNull()
		}
	} finally {
		view.dispose()
	}
})
