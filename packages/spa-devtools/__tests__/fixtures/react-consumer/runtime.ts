import assert from "node:assert/strict"
import { test } from "node:test"

import { StoreProvider } from "@atom.io/react"
import { AtomIODevtools } from "@atom.io/spa-devtools/react"
import { Silo } from "atom.io"
import { Window } from "happy-dom"
import { act, createElement, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"

async function actAsync(
	callback: (() => void) | (() => Promise<void>),
): Promise<void> {
	await act(callback)
}
const silo = () =>
	new Silo({ name: `packed-react`, lifespan: `ephemeral`, isProduction: true })
const counter = (app: Silo, value: number) =>
	app.atom<number>({ key: `count`, default: value })
const owned = (app: Silo) =>
	[...app.store.atoms.keys()].filter((key) => key.startsWith(`🔍 spa devtools`))

await test(`packed React entry imports and server renders without DOM`, () => {
	assert.equal(typeof globalThis.document, `undefined`)
	assert.equal(typeof globalThis.window, `undefined`)
	const app = silo()
	assert.equal(
		renderToString(
			createElement(StoreProvider, {
				store: app.store,
				children: createElement(AtomIODevtools),
			}),
		),
		`<div></div>`,
	)
	assert.deepEqual(owned(app), [])
})

await test(`packed React debugger survives StrictMode and switches provider and explicit stores`, async () => {
	const window = new Window()
	Object.assign(globalThis, {
		window,
		document: window.document,
		localStorage: window.localStorage,
		IS_REACT_ACT_ENVIRONMENT: true,
	})
	const first = silo()
	const second = silo()
	const firstCountAtom = counter(first, 1)
	const secondCountAtom = counter(second, 2)
	const host = document.createElement(`div`)
	document.body.append(host)
	const root = createRoot(host)
	const show = async (provider: Silo, explicit?: Silo) => {
		await actAsync(() => {
			root.render(
				createElement(
					StrictMode,
					null,
					createElement(StoreProvider, {
						store: provider.store,
						children: createElement(
							AtomIODevtools,
							explicit ? { store: explicit.store } : {},
						),
					}),
				),
			)
		})
		assert.equal(
			host.querySelectorAll(`[data-testid="atom-io-devtools"]`).length,
			1,
		)
	}
	const edit = async (value: string) => {
		const input = host.querySelector<HTMLInputElement>(
			`input[aria-label="count"]`,
		)!
		assert.ok(input)
		await actAsync(async () => {
			input.value = value
			input.dispatchEvent(
				new window.Event(`input`, { bubbles: true }) as unknown as Event,
			)
			for (let i = 0; i < 8; i++) await Promise.resolve()
		})
	}
	try {
		await show(first)
		await edit(`7`)
		assert.equal(first.getState(firstCountAtom), 7)
		assert.equal(second.getState(secondCountAtom), 2)
		await show(second)
		assert.deepEqual(owned(first), [])
		await edit(`8`)
		assert.equal(second.getState(secondCountAtom), 8)
		await show(second, first)
		assert.deepEqual(owned(second), [])
		await edit(`9`)
		assert.equal(first.getState(firstCountAtom), 9)
		assert.equal(second.getState(secondCountAtom), 8)
	} finally {
		await actAsync(() => {
			root.unmount()
		})
		assert.equal(host.childNodes.length, 0)
		assert.deepEqual(owned(first), [])
		assert.deepEqual(owned(second), [])
		await window.happyDOM.close()
	}
})
