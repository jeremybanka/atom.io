import { StoreProvider } from "@atom.io/react"
import { mountAtomIODevtools } from "@atom.io/spa-devtools"
import { AtomIODevtools } from "@atom.io/spa-devtools/react"
import { Silo } from "atom.io"
import { createElement, StrictMode } from "react"
import { createRoot } from "react-dom/client"

const host = document.createElement(`section`)
document.body.append(host)
function fixture() {
	const app = new Silo({
		name: `polish-browser`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = app.atom<number>({ key: `count`, default: 2 })
	const messageAtom = app.atom<string>({ key: `message`, default: `hello` })
	const recordAtom = app.atom<{
		a: number
		b: number
		list: number[]
		flag: boolean
	}>({
		key: `record`,
		default: { a: 1, b: 2, list: [3, 1], flag: false },
	})
	const cycle: Record<string, unknown> = {}
	cycle[`self`] = cycle
	app.atom<Record<string, unknown>>({ key: `circular`, default: cycle })
	app.atom<Map<string, number>>({ key: `map`, default: new Map([[`entry`, 1]]) })
	app.atom<number>({
		key: `a very long key that should remain discoverable without pushing controls out of reach`,
		default: 17,
	})
	const itemsAtoms = app.atomFamily<number, string>({ key: `items`, default: 0 })
	app.store.families.get(itemsAtoms.key)!.create(`first`)
	let reads = 0
	const rightSelector = app.selector<number>({
		key: `right`,
		get: () => {
			reads++
			return 5
		},
	})
	const belowSelector = app.selector<number>({
		key: `below`,
		get: () => {
			reads++
			return 6
		},
	})
	const leftSelector = app.selector<number>({
		key: `left`,
		get: () => {
			reads++
			return 7
		},
	})
	for (const [dependency, selector] of [
		[rightSelector.key, leftSelector.key],
		[countAtom.key, belowSelector.key],
		[countAtom.key, leftSelector.key],
		[belowSelector.key, rightSelector.key],
	])
		app.store.selectorGraph.set(
			{ upstreamSelectorKey: dependency, downstreamSelectorKey: selector },
			{ source: dependency },
		)
	app.selector<number>({
		key: `failed`,
		get: () => {
			throw new Error(`Example failure`)
		},
	})
	app.selector<Promise<unknown>>({
		key: `pending`,
		get: () => new Promise(() => {}),
	})
	const myTransaction = app.transaction<(amount: number) => number>({
		key: `my`,
		do: ({ get, set }, amount) => {
			set(countAtom, get(countAtom) + amount)
			return get(countAtom)
		},
	})
	app.timeline({ key: `history`, scope: [countAtom] })
	return {
		app,
		count: countAtom,
		text: messageAtom,
		record: recordAtom,
		transaction: myTransaction,
		reads: () => reads,
	}
}
let current = fixture(),
	other = fixture(),
	dispose = () => {}
let root: ReturnType<typeof createRoot> | undefined
const mode = new URLSearchParams(location.search).get(`mode`) ?? `spa`
function show(explicit = false) {
	if (mode === `spa`) {
		dispose()
		const panel = mountAtomIODevtools(host, { store: current.app.store })
		dispose = panel.dispose
	} else {
		root ??= createRoot(host)
		root.render(
			createElement(
				StrictMode,
				null,
				createElement(StoreProvider, {
					store: current.app.store,
					children: createElement(
						AtomIODevtools,
						explicit ? { store: other.app.store } : {},
					),
				}),
			),
		)
		dispose = () => {
			root!.unmount()
			root = undefined
		}
	}
}
localStorage.setItem(`🔍 Devtools View`, JSON.stringify(`atoms`))
localStorage.setItem(
	`🔍 Devtools Window`,
	JSON.stringify({
		free: { x: 0, y: 0, width: 1100, height: 800 },
		snap: `full`,
	}),
)
window.polish = {
	show,
	dispose: () => {
		dispose()
	},
	swap: () => {
		const previous = current
		current = other
		other = previous
		show()
	},
	run: () => current.app.runTransaction(current.transaction)(1),
	value: () => current.app.getState(current.count),
	longValue: () =>
		current.app.store.valueMap.get(
			`a very long key that should remain discoverable without pushing controls out of reach`,
		),
	record: () => current.app.getState(current.record),
	evidence: () => ({
		reads: current.reads(),
		cache: [...current.app.store.valueMap.keys()].filter(
			(key) => !key.startsWith(`🔍 `),
		),
		graph: JSON.stringify(current.app.store.selectorGraph.toJSON()),
	}),
}
show()
declare global {
	interface Window {
		polish: {
			show(explicit?: boolean): void
			dispose(): void
			swap(): void
			run(): number
			value(): number
			longValue(): unknown
			record(): unknown
			evidence(): { reads: number; cache: string[]; graph: string }
		}
		retainedInput?: Element
	}
}
