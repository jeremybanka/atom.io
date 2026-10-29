/* eslint-disable import/extensions -- This test executes built ESM directly in Node, which requires extensions. */
import assert from "node:assert/strict"

import { Silo } from "atom.io"
import { Window } from "happy-dom"

import {
	hydrate,
	jsx,
	onCleanup,
	render,
	useId,
	useSetter,
	useValue,
} from "../dist/client.min.js"
import { jsx as serverJsx } from "../dist/jsx-runtime.js"
import { renderToString } from "../dist/server.js"

const document = new Window().document
const silo = new Silo({
	name: `production`,
	lifespan: `ephemeral`,
	isProduction: true,
})
const countAtom = silo.atom<number>({ key: `count`, default: 0 })
let setups = 0
let cleanups = 0
function Counter() {
	setups++
	const count = useValue(countAtom)
	const setCount = useSetter(countAtom)
	const id = useId()
	onCleanup(() => {
		cleanups++
	})
	return jsx(`button`, {
		id,
		onClick: () => {
			setCount((value) => value + 1)
		},
		children: () => count(),
	})
}
const host = document.createElement(`section`)
const root = render(() => jsx(Counter, {}), host as unknown as Element, {
	store: silo.store,
})
const button = host.querySelector(`button`)!
button.click()
root.flush()
assert.equal(host.textContent, `1`)
assert.equal(setups, 1)
assert.equal(host.querySelector(`button`), button)
root.dispose()
assert.equal(cleanups, 1)
assert.equal(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size, 0)
// Server and the audited, bundled client share markup, not a module-level owner.
host.innerHTML = renderToString(() => serverJsx(`p`, { children: `hello` }), {
	idPrefix: `production`,
})
const paragraph = host.querySelector(`p`)
const hydrated = hydrate(
	() => jsx(`p`, { children: `hello` }),
	host as unknown as Element,
)
assert.equal(host.querySelector(`p`), paragraph)
hydrated.dispose()
assert.equal(host.childNodes.length, 0)
console.log(
	`Audited production artifact: state, events, ownership, IDs, cleanup and hydration passed.`,
)
