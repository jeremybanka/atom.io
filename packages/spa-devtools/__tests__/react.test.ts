import { StoreProvider } from "@atom.io/react"
import { Silo } from "atom.io"
import { act, createElement, StrictMode } from "react"
import type { Root } from "react-dom/client"
import { createRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, expect, it } from "vitest"

import type { AtomIODevtoolsProps } from "../src/react.ts"
import { AtomIODevtools } from "../src/react.ts"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
async function actAsync(
	callback: (() => void) | (() => Promise<void>),
): Promise<void> {
	await act(callback)
}
const roots: Root[] = []
beforeEach(() => {
	localStorage.clear()
})
afterEach(async () => {
	for (const root of roots.splice(0))
		await actAsync(() => {
			root.unmount()
		})
	document.body.replaceChildren()
})
const silo = () =>
	new Silo({ name: `react-mount`, lifespan: `ephemeral`, isProduction: true })
const counter = (app: Silo, value: number) =>
	app.atom<number>({ key: `count`, default: value })
const owned = (app: Silo) =>
	[...app.store.atoms.keys()].filter((key) => key.startsWith(`🔍 spa devtools`))

it(`replays StrictMode, follows provider changes and gives explicit stores precedence`, async () => {
	const first = silo()
	const second = silo()
	const override = silo()
	const firstCountAtom = counter(first, 1)
	const secondCountAtom = counter(second, 2)
	const overrideCountAtom = counter(override, 3)
	const host = document.createElement(`div`)
	document.body.append(host)
	const root = createRoot(host)
	roots.push(root)
	const show = async (provider: Silo, props: AtomIODevtoolsProps = {}) => {
		await actAsync(() => {
			root.render(
				createElement(
					StrictMode,
					null,
					createElement(StoreProvider, {
						store: provider.store,
						children: createElement(AtomIODevtools, props),
					}),
				),
			)
		})
		expect(
			host.querySelectorAll(`[data-testid="atom-io-devtools"]`),
		).toHaveLength(1)
	}
	const edit = async (value: string) => {
		const input = host.querySelector<HTMLInputElement>(
			`input[aria-label="count"]`,
		)!
		await actAsync(async () => {
			input.value = value
			input.dispatchEvent(new Event(`input`, { bubbles: true }))
			for (let i = 0; i < 8; i++) await Promise.resolve()
		})
	}
	await show(first)
	await edit(`7`)
	expect(first.getState(firstCountAtom)).toBe(7)
	expect(second.getState(secondCountAtom)).toBe(2)
	await show(second)
	expect(owned(first)).toEqual([])
	await edit(`8`)
	expect(second.getState(secondCountAtom)).toBe(8)
	await show(first, { store: override.store })
	expect(owned(second)).toEqual([])
	await edit(`9`)
	expect(override.getState(overrideCountAtom)).toBe(9)
	expect(first.getState(firstCountAtom)).toBe(7)
	const keys = owned(override)
	await show(second, { store: override.store })
	expect(owned(override)).toEqual(keys)
	await show(second, { store: override.store, hideByDefault: true })
	expect(host.querySelector<HTMLElement>(`main`)!.hidden).toBe(true)
	expect(owned(override).some((key) => keys.includes(key))).toBe(false)
	await show(first)
	expect(owned(override)).toEqual([])
	await actAsync(() => {
		root.unmount()
	})
	roots.splice(roots.indexOf(root), 1)
	expect(owned(first)).toEqual([])
	expect(host.childNodes.length).toBe(0)
})

it(`server rendering creates no panel or UI family members`, () => {
	const app = silo()
	const html = renderToString(
		createElement(StoreProvider, {
			store: app.store,
			children: createElement(AtomIODevtools),
		}),
	)
	expect(html).toBe(`<div></div>`)
	expect(owned(app)).toEqual([])
})
