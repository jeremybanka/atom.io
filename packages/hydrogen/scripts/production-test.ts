/* eslint-disable import/extensions -- This test executes built ESM directly in Node, which requires extensions. */
import assert from "node:assert/strict"

import type { Loadable } from "atom.io"
import { scopeFamily, Silo } from "atom.io"
import { Window } from "happy-dom"

import {
	hydrate,
	jsx,
	onCleanup,
	render,
	useId,
	useLoadable,
	useRef,
	useSetter,
	useStore,
	useTimeline,
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
	assert.equal(useStore(), silo.store)
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
const deferred = Promise.withResolvers<string>()
const loadableAtom = silo.atom<Loadable<string>>({
	key: `loadable`,
	default: () => deferred.promise,
})
const asyncRoot = render(
	() => {
		const value = useLoadable(loadableAtom, `pending`)
		return jsx(`output`, { children: () => value().value })
	},
	host as unknown as Element,
	{ store: silo.store },
)
assert.equal(host.textContent, `pending`)
deferred.resolve(`ready`)
await new Promise<void>((resolve) => setTimeout(resolve, 0))
asyncRoot.flush()
assert.equal(host.textContent, `ready`)
asyncRoot.dispose()
assert.equal(silo.store.atoms.get(loadableAtom.key)!.subject.subscribers.size, 0)

const rowAtoms = silo.atomFamily<number, boolean>({ key: `row`, default: 0 })
const buttonAtoms = silo.atomFamily<HTMLButtonElement | null, boolean>({
	key: `button`,
	default: null,
})
const rowHistoryTimelines = silo.timelineFamily<boolean>({
	key: `rowHistory`,
	scope: [scopeFamily(rowAtoms, { timelineKey: (key) => key })],
})
const familyRoot = render(
	() => {
		const count = useValue(rowAtoms, false)
		const setCount = useSetter(rowAtoms, false)
		const ref = useRef(buttonAtoms, false)
		const history = useTimeline(rowHistoryTimelines, false)
		return jsx(`button`, {
			ref,
			onClick: () => {
				setCount((value) => value + 1)
			},
			children: () => `${count()}:${history().at}`,
		})
	},
	host as unknown as Element,
	{ store: silo.store },
)
silo.clearTimeline(rowHistoryTimelines, false)
familyRoot.flush()
const familyButton = host.querySelector(`button`)!
assert.equal(silo.getState(buttonAtoms, false), familyButton)
familyButton.click()
familyRoot.flush()
assert.equal(host.textContent, `1:1`)
silo.undo(rowHistoryTimelines, false)
familyRoot.flush()
assert.equal(host.textContent, `0:0`)
familyRoot.dispose()
assert.equal(silo.getState(buttonAtoms, false), null)

console.log(
	`Audited production artifact: state, events, ownership, store context, IDs, loadable state, families, cleanup and hydration passed.`,
)
