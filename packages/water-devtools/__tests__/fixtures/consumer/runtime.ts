import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { render } from "@atom.io/water"
import { jsx } from "@atom.io/water/jsx-runtime"
import { AtomIODevtools } from "@atom.io/water-devtools"
import { Silo } from "atom.io"
import { Window } from "happy-dom"

await test(`packed debugger edits its inspected store and cleans up owned state`, async () => {
	const window = new Window()
	Object.assign(globalThis, {
		window,
		document: window.document,
		localStorage: window.localStorage,
	})
	const silo = new Silo({
		name: `consumer`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 1 })
	const host = document.createElement(`div`)
	const root = render(() => jsx(AtomIODevtools, { store: silo.store }), host)
	const input = host.querySelector<HTMLInputElement>(
		`input[aria-label="count"]`,
	)!
	assert.ok(input)
	input.value = `7`
	input.dispatchEvent(new window.Event(`input`) as unknown as Event)
	for (let i = 0; i < 8; i++) await Promise.resolve()
	assert.equal(silo.getState(countAtom), 7)
	root.dispose()
	assert.equal(host.childNodes.length, 0)
	assert.equal(
		[...silo.store.atoms.keys()].some((key) =>
			key.startsWith(`🔍 water devtools`),
		),
		false,
	)
	assert.match(
		readFileSync(
			new URL(import.meta.resolve(`@atom.io/water-devtools/css`)),
			`utf8`,
		),
		/water-devtools/,
	)
})
