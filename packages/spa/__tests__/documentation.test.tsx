import { getState, setState, Silo } from "atom.io"
import { takeSnapshot } from "atom.io/testing"
import { afterEach, expect, it, vi } from "vitest"

import { AccountSettings } from "../exhibits/hooks/on-cleanup.tsx"
import { SearchDialog } from "../exhibits/hooks/on-mount.tsx"
import { CartCount, cartCountAtom } from "../exhibits/hooks/use-getter.tsx"
import { AccountName } from "../exhibits/hooks/use-loadable.tsx"
import { SearchField, searchFieldAtom } from "../exhibits/hooks/use-ref.tsx"
import { SearchBox, searchQueryAtom } from "../exhibits/hooks/use-setter.tsx"
import { CopyDraft, draftTextAtom } from "../exhibits/hooks/use-store.tsx"
import { noteAtom, UndoNote } from "../exhibits/hooks/use-timeline.tsx"
import {
	AddToCart,
	cartItemsAtom,
	cartOpenAtom,
} from "../exhibits/hooks/use-transaction.tsx"
import { ContactFields } from "../exhibits/rendering/fragment.tsx"
import { hydrateEmailField } from "../exhibits/rendering/hydrate.tsx"
import { mountCounter } from "../exhibits/rendering/render.tsx"
import { renderEmailField } from "../exhibits/rendering/render-to-string.tsx"
import type { Children, RootOptions, SpaRoot } from "../src/index.ts"
import { render } from "../src/index.ts"
import { renderToString } from "../src/server.ts"

const snapshot = takeSnapshot()
const cleanups: (() => void)[] = []
const initialTitle = document.title

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	snapshot.restore()
	vi.unstubAllGlobals()
	document.body.replaceChildren()
	document.title = initialTitle
})

function mount(setup: () => Children, options: RootOptions = {}) {
	const host = document.createElement(`section`)
	document.body.append(host)
	const root = render(setup, host, options)
	cleanups.push(root.dispose)
	return { host, root }
}

async function settled(root: SpaRoot, check: () => void): Promise<void> {
	await vi.waitFor(() => {
		root.flush()
		check()
	})
}

it(`the render exhibit mounts an interactive widget and returns its teardown`, async () => {
	const host = document.createElement(`section`)
	document.body.append(host)
	const dispose = mountCounter(host)
	cleanups.push(dispose)
	const button = host.querySelector(`button`)!
	expect(button.textContent).toBe(`Count: 0`)
	button.click()
	await vi.waitFor(() => {
		expect(button.textContent).toBe(`Count: 1`)
	})
	dispose()
	expect(host.childNodes).toHaveLength(0)
})

it(`the server and hydration exhibits preserve the input and useId label`, () => {
	const host = document.createElement(`form`)
	host.innerHTML = renderEmailField()
	document.body.append(host)
	const input = host.querySelector(`input`)!
	const id = input.id
	const root = hydrateEmailField(host)
	cleanups.push(root.dispose)
	expect(host.querySelector(`input`)).toBe(input)
	expect(input.id).toBe(id)
	expect(host.querySelector(`label`)!.htmlFor).toBe(id)
})

it(`the Fragment exhibit adds fields without a wrapper`, () => {
	const { host } = mount(() => (
		<form>
			<ContactFields />
		</form>
	))
	const form = host.querySelector(`form`)!
	expect(form.children).toHaveLength(2)
	expect([...form.children].map((element) => element.tagName)).toEqual([
		`LABEL`,
		`LABEL`,
	])
	expect(form.elements).toHaveLength(2)
})

it(`the getter and setter exhibits observe and publish application state`, () => {
	const { host, root } = mount(() => (
		<>
			<CartCount />
			<SearchBox />
		</>
	))
	setState(cartCountAtom, 3)
	root.flush()
	expect(host.querySelector(`output`)!.textContent).toBe(`3`)
	const input = host.querySelector(`input`)!
	input.value = `coffee`
	input.dispatchEvent(new Event(`input`, { bubbles: true }))
	expect(getState(searchQueryAtom)).toBe(`coffee`)
})

it(`the loadable exhibit starts with a fallback and displays the fetched name`, async () => {
	const response = Promise.withResolvers<Response>()
	const fetchName = vi.fn(() => response.promise)
	vi.stubGlobal(`fetch`, fetchName)
	const { host, root } = mount(() => <AccountName />)
	expect(host.textContent).toBe(`Loading your account…`)
	expect(host.querySelector(`p`)!.getAttribute(`aria-busy`)).toBe(`true`)
	response.resolve(new Response(`Ada`))
	await settled(root, () => {
		expect(host.textContent).toBe(`Ada`)
		expect(host.querySelector(`p`)!.getAttribute(`aria-busy`)).toBe(`false`)
	})
	expect(fetchName).toHaveBeenCalledExactlyOnceWith(`/api/account/name`)
})

it(`the loadable exhibit displays a handled HTTP error`, async () => {
	vi.stubGlobal(
		`fetch`,
		vi.fn(() => Promise.resolve(new Response(``, { status: 503 }))),
	)
	const { host, root } = mount(() => <AccountName />)
	await settled(root, () => {
		expect(host.textContent).toBe(`Could not load your account`)
	})
})

it(`the timeline exhibit enables Undo after an edit and restores the note`, () => {
	getState(noteAtom)
	const { host, root } = mount(() => <UndoNote />)
	const button = host.querySelector(`button`)!
	expect(button.disabled).toBe(true)
	setState(noteAtom, `A draft`)
	root.flush()
	expect(button.disabled).toBe(false)
	button.click()
	root.flush()
	expect(getState(noteAtom)).toBe(``)
	expect(button.disabled).toBe(true)
})

it(`the transaction exhibit updates cart contents and visibility together`, () => {
	const { host } = mount(() => <AddToCart sku="coffee-beans" />)
	host.querySelector(`button`)!.click()
	expect(getState(cartItemsAtom)).toEqual([`coffee-beans`])
	expect(getState(cartOpenAtom)).toBe(true)
})

it(`the ref exhibit publishes its element and clears it on disposal`, () => {
	const { host, root } = mount(() => <SearchField />)
	expect(getState(searchFieldAtom)).toBe(host.querySelector(`input`))
	root.dispose()
	expect(getState(searchFieldAtom)).toBe(null)
})

it(`mount and cleanup exhibits skip SSR work, focus the field, and restore the title`, () => {
	document.title = `Shop`
	renderToString(() => (
		<>
			<SearchDialog />
			<AccountSettings />
		</>
	))
	expect(document.title).toBe(`Shop`)
	const { host, root } = mount(() => (
		<>
			<SearchDialog />
			<AccountSettings />
		</>
	))
	expect(document.activeElement).toBe(host.querySelector(`input`))
	expect(document.title).toBe(`Account settings`)
	root.dispose()
	expect(document.title).toBe(`Shop`)
})

it(`the store exhibit copies from its selected store instead of the implicit one`, () => {
	const silo = new Silo({
		name: `copy-draft`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	silo.install([draftTextAtom])
	silo.setState(draftTextAtom, `Private draft`)
	setState(draftTextAtom, `Implicit draft`)
	const writeText = vi.fn(async () => {})
	vi.stubGlobal(`navigator`, { clipboard: { writeText } })
	const { host } = mount(() => <CopyDraft />, { store: silo.store })
	host.querySelector(`button`)!.click()
	expect(writeText).toHaveBeenCalledExactlyOnceWith(`Private draft`)
})
