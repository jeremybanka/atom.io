import { mountAtomIODevtools } from "@atom.io/spa-devtools"
import { Silo } from "atom.io"

const host = document.createElement(`div`)
document.body.append(host)
let app: Silo,
	reads = 0,
	dispose = () => {},
	setupMs = 0,
	mountStarted = 0
let update = () => {}
function mount(large = false) {
	dispose()
	host.replaceChildren()
	localStorage.clear()
	reads = 0
	app = new Silo({
		name: `search-browser`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const start = performance.now()
	if (large) {
		const atoms: string[] = [],
			selectors: string[] = []
		for (let i = 0; i < 10; i++) {
			const cartOptions = {
				key: `cartQuantity${i}`,
				default: () => {
					reads++
					return 0
				},
			}
			const cartQuantityAtoms = app.atomFamily<number, number>(cartOptions)
			const totalOptions = {
				key: `orderTotal${i}`,
				get: () => () => {
					reads++
					return 0
				},
			}
			const orderTotalSelectors = app.selectorFamily<number, number>(
				totalOptions,
			)
			for (let j = 0; j < 500; j++) {
				const atom = app.store.families.get(cartQuantityAtoms.key)!.create(j),
					selector = app.store.families.get(orderTotalSelectors.key)!.create(j)
				atoms.push(atom.key)
				selectors.push(selector.key)
				app.store.valueMap.set(atom.key, `SKU-${i}-${j}`)
			}
		}
		for (let i = 0; i < selectors.length; i++)
			for (let j = 0; j < 6; j++) {
				const source = atoms[(i + j * 731) % atoms.length]
				app.store.selectorGraph.set(
					{ upstreamSelectorKey: source, downstreamSelectorKey: selectors[i] },
					{ source },
				)
			}
		update = () => {
			app.store.valueMap.set(atoms[0], `refreshed`)
		}
	} else {
		const countAtom = app.atom<number>({ key: `count`, default: 2 })
		app.atom<unknown>({ key: `record`, default: { a: 1, b: 2 } })
		app.atom<unknown>({ key: `message`, default: `fulfilled` })
		const itemsAtoms = app.atomFamily<number, string>({
			key: `items`,
			default: () => {
				reads++
				return 8
			},
		})
		app.store.families.get(itemsAtoms.key)!.create(`dormant`)
		const derivedSelectors = app.selectorFamily<number, string>({
			key: `derived`,
			get: () => () => {
				reads++
				return 3
			},
		})
		app.store.families.get(derivedSelectors.key)!.create(`dormant`)
		update = () => {
			app.setState(countAtom, 17)
		}
	}
	setupMs = performance.now() - start
	localStorage.setItem(
		`🔍 Devtools Window`,
		JSON.stringify({
			free: { x: 0, y: 0, width: 700, height: 800 },
			snap: `full`,
		}),
	)
	mountStarted = performance.now()
	dispose = mountAtomIODevtools(host, { store: app.store }).dispose
}
function evidence() {
	return {
		reads,
		setupMs,
		mountStarted,
		selectors: [
			...app.store.readonlySelectors.keys(),
			...app.store.writableSelectors.keys(),
		].filter((key) => !key.startsWith(`🔍 `)).length,
		observedEdges: app.store.selectorGraph.toJSON().contents.length,
		cache: [...app.store.valueMap.keys()].filter(
			(key) => !key.startsWith(`🔍 `),
		),
		atoms: [...app.store.atoms.keys()].filter((key) => !key.startsWith(`🔍 `)),
		graph: app.store.selectorGraph.toJSON(),
	}
}
declare global {
	interface Window {
		searchFixture: {
			mount: typeof mount
			update(): void
			evidence: typeof evidence
		}
	}
}
window.searchFixture = {
	mount,
	update: () => {
		update()
	},
	evidence,
}
mount()
