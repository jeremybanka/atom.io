import * as spa from "@atom.io/spa"
import { Silo } from "atom.io"
import { IMPLICIT } from "atom.io/internal"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import type { AtomIODevtoolsHandle } from "../src/index.ts"
import { mountAtomIODevtools } from "../src/index.ts"

const panels: AtomIODevtoolsHandle[] = []
beforeEach(() => {
	localStorage.clear()
})
afterEach(() => {
	for (const panel of panels.splice(0)) panel.dispose()
	vi.restoreAllMocks()
	document.body.replaceChildren()
})
const tick = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve()
}
const silo = () =>
	new Silo({ name: `mount`, lifespan: `ephemeral`, isProduction: true })
const counter = (app: Silo, value: number) =>
	app.atom<number>({ key: `count`, default: value })
const ownedKeys = (store: Silo[`store`]) =>
	[...store.atoms.keys()].filter((key) => key.startsWith(`🔍 spa devtools`))

it(`preserves caller DOM and releases owned state and global listeners across 50 cycles`, () => {
	const store = silo().store
	const host = document.createElement(`section`)
	const sibling = document.createElement(`button`)
	host.append(sibling)
	document.body.append(host)
	const documentAdd = vi.spyOn(document, `addEventListener`)
	const documentRemove = vi.spyOn(document, `removeEventListener`)
	const windowAdd = vi.spyOn(window, `addEventListener`)
	const windowRemove = vi.spyOn(window, `removeEventListener`)
	for (let cycle = 0; cycle < 50; cycle++) {
		const panel = mountAtomIODevtools(host, { store })
		panels.push(panel)
		expect(ownedKeys(store).length).toBeGreaterThan(0)
		expect(host.querySelector(`[data-testid="atom-io-devtools"]`)).not.toBeNull()
		panel.dispose()
		panel.dispose()
		expect(ownedKeys(store)).toEqual([])
		expect([...host.childNodes]).toEqual([sibling])
	}
	const addedKeys = documentAdd.mock.calls.filter(([type]) => type === `keydown`)
	const removedKeys = documentRemove.mock.calls.filter(
		([type]) => type === `keydown`,
	)
	expect(addedKeys).toHaveLength(50)
	expect(removedKeys).toEqual(addedKeys)
	const addedResize = windowAdd.mock.calls.filter(([type]) => type === `resize`)
	expect(addedResize).toHaveLength(50)
	expect(windowRemove.mock.calls.filter(([type]) => type === `resize`)).toEqual(
		addedResize,
	)
})

it(`keeps panels on one store independently subscribed and disposable`, async () => {
	const app = silo()
	const countAtom = app.atom<number>({ key: `count`, default: 1 })
	const host = document.createElement(`div`)
	const first = mountAtomIODevtools(host, { store: app.store })
	const firstKeys = ownedKeys(app.store)
	const second = mountAtomIODevtools(host, { store: app.store })
	panels.push(first, second)
	expect(ownedKeys(app.store).length).toBe(firstKeys.length * 2)
	const countState = app.store.atoms.get(countAtom.key)!
	const subscribers = [...countState.subject.subscribers.keys()]
	expect(subscribers.length).toBeGreaterThanOrEqual(2)
	expect(new Set(subscribers).size).toBe(subscribers.length)
	first.dispose()
	expect(ownedKeys(app.store).some((key) => firstKeys.includes(key))).toBe(false)
	app.setState(countAtom, 9)
	await tick()
	const input = host.querySelector<HTMLInputElement>(
		`input[aria-label="count"]`,
	)!
	expect(input.value).toBe(`9`)
	input.value = `12`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	await tick()
	expect(app.getState(countAtom)).toBe(12)
	second.dispose()
	expect(countState.subject.subscribers.size).toBe(0)
	expect(ownedKeys(app.store)).toEqual([])
})

it(`isolates edits between stores and captures options at mount`, async () => {
	const first = silo()
	const second = silo()
	const firstCountAtom = counter(first, 1)
	const secondCountAtom = counter(second, 2)
	const host = document.createElement(`div`)
	const options = { store: first.store, hideByDefault: true }
	panels.push(mountAtomIODevtools(host, options))
	options.store = second.store
	options.hideByDefault = false
	panels.push(mountAtomIODevtools(host, options))
	const inputs = host.querySelectorAll<HTMLInputElement>(
		`input[aria-label="count"]`,
	)
	expect(host.querySelector<HTMLElement>(`main`)!.hidden).toBe(true)
	inputs[0].value = `7`
	inputs[0].dispatchEvent(new Event(`input`, { bubbles: true }))
	await tick()
	expect(first.getState(firstCountAtom)).toBe(7)
	expect(second.getState(secondCountAtom)).toBe(2)
	expect(inputs[1].value).toBe(`2`)
})

it(`defaults to the implicit store`, () => {
	const host = document.createElement(`div`)
	const panel = mountAtomIODevtools(host)
	panels.push(panel)
	expect(ownedKeys(IMPLICIT.STORE).length).toBeGreaterThan(0)
	panel.dispose()
	expect(ownedKeys(IMPLICIT.STORE)).toEqual([])
})

it(`removes its container if mounting fails`, () => {
	const host = document.createElement(`div`)
	const sibling = document.createTextNode(`owned by caller`)
	host.append(sibling)
	vi.spyOn(spa, `render`).mockImplementationOnce(() => {
		throw new Error(`mount failed`)
	})
	expect(() => mountAtomIODevtools(host)).toThrow(`mount failed`)
	expect([...host.childNodes]).toEqual([sibling])
})

it(`removes its container even when root disposal throws, without retrying disposal`, () => {
	const host = document.createElement(`div`)
	const dispose = vi.fn(() => {
		throw new Error(`dispose failed`)
	})
	vi.spyOn(spa, `render`).mockReturnValueOnce({ dispose, flush() {} })
	const panel = mountAtomIODevtools(host)
	expect(() => {
		panel.dispose()
	}).toThrow(`dispose failed`)
	expect(() => {
		panel.dispose()
	}).not.toThrow()
	expect(dispose).toHaveBeenCalledTimes(1)
	expect(host.childNodes.length).toBe(0)
})
