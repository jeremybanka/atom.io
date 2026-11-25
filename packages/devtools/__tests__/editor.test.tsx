import { render, useGetter } from "@atom.io/spa"
import { Silo } from "atom.io"
import { expect, it } from "vitest"

import { EventView } from "../src/EventView.tsx"
import { JsonEditor } from "../src/JsonEditor.tsx"
import { StateLeaf } from "../src/StateLeaf.tsx"
import { useTools } from "../src/store.ts"

it(`renders a root primitive with a default accessible label and tokenless molecule events`, () => {
	const silo = new Silo({
		name: `events`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const host = document.createElement(`div`)
	const event = {
		type: `molecule_creation` as const,
		key: `item`,
		provenance: `list`,
		timestamp: 1,
	}
	const root = render(
		() => {
			const tools = useTools(silo.store)
			return (
				<>
					<JsonEditor tools={tools} path={[]} stateKey="root" value="root" />
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

it(`does not recreate a disposed retained editor when surrounding UI props invalidate`, async () => {
	const silo = new Silo({
		name: `retained-disposal`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const itemsAtoms = silo.atomFamily<number, string>({
		key: `items`,
		default: 0,
	})
	const token = silo.store.families.get(itemsAtoms.key)!.create(`one`)
	const revisionAtom = silo.atom<number>({ key: `revision`, default: 0 })
	const host = document.createElement(`section`)
	const root = render(
		() => {
			const getRevision = useGetter(revisionAtom)
			return (
				<StateLeaf
					tools={useTools(silo.store)}
					token={token}
					retained={getRevision() >= 0}
				/>
			)
		},
		host,
		{ store: silo.store },
	)
	silo.disposeState(itemsAtoms, `one`)
	silo.setState(revisionAtom, 1)
	await Promise.resolve()
	root.flush()
	expect(host.textContent).toContain(`State was disposed`)
	expect(silo.store.atoms.has(token.key)).toBe(false)
	root.dispose()
})
