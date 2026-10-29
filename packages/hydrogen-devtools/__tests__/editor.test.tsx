import { Silo } from "atom.io"
import { render } from "hydrogen"
import { expect, it } from "vitest"

import { EventView } from "../src/Indexes.tsx"
import { JsonEditor } from "../src/JsonEditor.tsx"
import { useTools } from "../src/store.ts"

it(`renders a root primitive with a default accessible label and tokenless molecule events`, () => {
	const silo = new Silo({
		name: `events`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const host = document.createElement(`div`)
	const event = {
		type: `molecule_creation`,
		key: `item`,
		provenance: `list`,
		timestamp: 1,
	}
	const root = render(
		() => {
			const tools = useTools(silo.store)
			return (
				<>
					<JsonEditor tools={tools} path={[]} value="root" />
					<EventView tools={tools} event={event} index={0} />
				</>
			)
		},
		host,
		{ store: silo.store },
	)
	expect(
		host.querySelector<HTMLInputElement>(`[aria-label="value"]`)!.value,
	).toBe(`root`)
	expect(host.textContent).toContain(JSON.stringify(event))
	root.dispose()
})
