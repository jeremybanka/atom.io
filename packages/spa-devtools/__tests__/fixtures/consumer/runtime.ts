import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import { render } from "@atom.io/spa"
import { jsx } from "@atom.io/spa/jsx-runtime"
import {
	AtomIODevtools,
	captureEcologySnapshot,
	mountAtomIODevtools,
	traceEcologyRoots,
} from "@atom.io/spa-devtools"
import { Silo } from "atom.io"
import { Window } from "happy-dom"

await test(`packed ecology exports remain passive and trace observed selector roots`, () => {
	const silo = new Silo({
		name: `ecology-consumer`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 2 })
	let reads = 0
	const doubleSelector = silo.selector<number>({
		key: `double`,
		get: ({ get }) => {
			reads++
			return get(countAtom) * 2
		},
	})
	const unknown = captureEcologySnapshot(silo.store)
	assert.equal(reads, 0)
	assert.equal(traceEcologyRoots(unknown, `double`).status, `incomplete`)
	assert.equal(silo.getState(doubleSelector), 4)
	const snapshot = captureEcologySnapshot(silo.store)
	assert.deepEqual(traceEcologyRoots(snapshot, `double`).rootKeys, [`count`])
	assert.equal(reads, 1)
})

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
	const sibling = document.createElement(`button`)
	host.append(sibling)
	const panel = mountAtomIODevtools(host, { store: silo.store })
	assert.ok(host.querySelector(`input[aria-label="count"]`))
	panel.dispose()
	panel.dispose()
	assert.deepEqual([...host.childNodes], [sibling])
	assert.equal(
		[...silo.store.atoms.keys()].some((key) =>
			key.startsWith(`🔍 spa devtools`),
		),
		false,
	)
	assert.match(
		readFileSync(
			new URL(import.meta.resolve(`@atom.io/spa-devtools/css`)),
			`utf8`,
		),
		/spa-devtools/,
	)
})
