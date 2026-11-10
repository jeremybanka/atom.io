import { atomFamily, findState, getState, setState, Silo } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { IMPLICIT } from "atom.io/internal"
import { takeSnapshot } from "atom.io/testing"
import { afterEach, expect, it } from "vitest"

import type { SpaRoot } from "../src/index.ts"
import { onCleanup, render, useDisposal, useGetter } from "../src/index.ts"
import { renderToString } from "../src/server.ts"

const disposalVisibilityAtoms = atomFamily<boolean, Canonical>({
	key: `disposalVisibility`,
	default: false,
})
const snapshot = takeSnapshot()
const roots: SpaRoot[] = []
afterEach(() => {
	for (const root of roots.splice(0)) root.dispose()
	snapshot.restore()
	document.body.replaceChildren()
})
function host(): HTMLElement {
	const element = document.createElement(`section`)
	document.body.append(element)
	return element
}
function silo(name: string): Silo {
	const isolated = new Silo({ name, lifespan: `ephemeral`, isProduction: true })
	isolated.install([disposalVisibilityAtoms])
	return isolated
}

it(`captures implicit-store disposal for a member token invoked from an event`, () => {
	setState(disposalVisibilityAtoms, `menu`, true)
	const member = findState(disposalVisibilityAtoms, `menu`)
	const element = host()
	const root = render(() => {
		const dispose = useDisposal()
		return (
			<button
				onClick={() => {
					dispose(member)
				}}
			>
				Dismiss menu
			</button>
		)
	}, element)
	roots.push(root)
	expect(IMPLICIT.STORE.atoms.has(member.key)).toBe(true)
	element.querySelector(`button`)!.click()
	expect(IMPLICIT.STORE.atoms.has(member.key)).toBe(false)
	expect(getState(disposalVisibilityAtoms, `menu`)).toBe(false)
})

it.each(
	([0, ``, false, null, [`toolbar`, 1]] as Canonical[]).map(
		(key) => [key] as const,
	),
)(
	`disposes family key %j in the captured store after another root is mounted`,
	(key) => {
		const first = silo(`first`)
		const second = silo(`second`)
		setState(disposalVisibilityAtoms, key, true)
		first.setState(disposalVisibilityAtoms, key, true)
		second.setState(disposalVisibilityAtoms, key, true)
		const member = first.findState(disposalVisibilityAtoms, key)
		const a = render(
			() => {
				const dispose = useDisposal()
				onCleanup(() => {
					dispose(disposalVisibilityAtoms, key)
				})
				return null
			},
			host(),
			{ store: first.store },
		)
		const b = render(
			() => {
				const getVisible = useGetter(disposalVisibilityAtoms, key)
				return <output>{String(getVisible())}</output>
			},
			host(),
			{ store: second.store },
		)
		roots.push(a, b)
		a.dispose()
		a.dispose()
		expect(first.store.atoms.has(member.key)).toBe(false)
		expect(second.store.atoms.has(member.key)).toBe(true)
		expect(second.getState(disposalVisibilityAtoms, key)).toBe(true)
		expect(getState(disposalVisibilityAtoms, key)).toBe(true)
	},
)

it(`disposes selector-family members during server cleanup in the selected store`, () => {
	const selected = silo(`server`)
	const helpLabelSelectors = selected.selectorFamily<string, string>({
		key: `helpLabel`,
		get: (key) => () => key.toUpperCase(),
	})
	const member = selected.findState(helpLabelSelectors, `formatting`)
	selected.getState(helpLabelSelectors, `shortcuts`)
	const retained = selected.findState(helpLabelSelectors, `shortcuts`)
	const html = renderToString(
		() => {
			const getLabel = useGetter(helpLabelSelectors, `formatting`)
			const dispose = useDisposal()
			onCleanup(() => {
				dispose(helpLabelSelectors, `formatting`)
			})
			return <output>{getLabel()}</output>
		},
		{ store: selected.store },
	)
	expect(html).toContain(`FORMATTING`)
	expect(selected.store.readonlySelectors.has(member.key)).toBe(false)
	expect(selected.store.readonlySelectors.has(retained.key)).toBe(true)
})
