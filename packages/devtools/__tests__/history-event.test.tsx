import { render } from "@atom.io/spa"
import { Silo } from "atom.io"
import { expect, it } from "vitest"

import { EventView } from "../src/EventView.tsx"
import type { RecordedEvent } from "../src/history-event.ts"
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
