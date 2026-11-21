import { mountAtomIODevtools } from "@atom.io/devtools"
import { type Loadable, type RegularAtomToken, Silo } from "atom.io"

const host = document.createElement(`section`)
document.body.append(host)
let panel = { dispose() {} },
	app: Silo,
	reads = 0,
	mountStarted = 0,
	setupMs = 0
let change = () => {},
	remove = () => {}
let brokenAtom:
	| RegularAtomToken<Loadable<number | Error>, any, Error>
	| undefined
function mount(mode: `small` | `empty` | `large`): void {
	panel.dispose()
	brokenAtom = undefined
	const start = performance.now()
	app = new Silo({
		name: `ecology-browser`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	reads = 0
	if (mode === `small`) {
		const priceAtom = app.atom<number>({ key: `price`, default: 5 })
		const totalSelector = app.selector<number>({
			key: `total`,
			get: ({ get }) => get(priceAtom) * 2,
		})
		app.getState(totalSelector)
		app.selector<number>({
			key: `dormant`,
			get: () => {
				reads++
				return 7
			},
		})
		app.atom<number>({
			key: `lazy`,
			default: () => {
				reads++
				return 1
			},
		})
		const itemsAtoms = app.atomFamily<number, string>({
			key: `items`,
			default: () => {
				reads++
				return 1
			},
		})
		app.store.families.get(itemsAtoms.key)!.create(`a`)
		const itemAtom = app.findState(itemsAtoms, `a`)
		app.selector<number>({ key: `itemTotal`, get: ({ get }) => get(itemAtom) })
		app.store.selectorGraph.set(
			{ upstreamSelectorKey: itemAtom.key, downstreamSelectorKey: `itemTotal` },
			{ source: itemAtom.key },
		)
		app.atomFamily<number, string>({ key: `zero`, default: 0 })
		change = () => {
			app.setState(priceAtom, 6)
			app.getState(totalSelector)
		}
		remove = () => {
			app.disposeState(itemsAtoms, `a`)
		}
	}
	if (mode === `large`) {
		for (let family = 0; family < 10; family++) {
			const options = {
				key: `batch${family}`,
				default: () => {
					reads++
					return 0
				},
			}
			const batchAtoms = app.atomFamily<number, number>(options)
			for (let member = 0; member < 500; member++)
				app.store.families.get(batchAtoms.key)!.create(member)
		}
		const atoms = [...app.store.atoms.keys()]
		for (let index = 0; index < 5_000; index++) {
			const key = `derived${index}`
			app.selector<number>({
				key,
				get: () => {
					reads++
					return 0
				},
			})
			for (let dependency = 0; dependency < 6; dependency++) {
				const source = atoms[(index + dependency * 731) % atoms.length]
				app.store.selectorGraph.set(
					{ upstreamSelectorKey: source, downstreamSelectorKey: key },
					{ source },
				)
			}
		}
	}
	setupMs = performance.now() - start
	localStorage.setItem(`🔍 Devtools View`, JSON.stringify(`ecology`))
	localStorage.setItem(`🔍 Devtools Are Hidden`, `false`)
	localStorage.setItem(`🔍 Devtools Are Open`, `true`)
	localStorage.setItem(
		`🔍 Devtools Window`,
		JSON.stringify({
			free: { x: 20, y: 20, width: 1100, height: 740 },
			snap: `full`,
		}),
	)
	mountStarted = performance.now()
	panel = mountAtomIODevtools(host, { store: app.store })
}
declare global {
	interface Window {
		ecologyFixture: {
			mount: typeof mount
			change(): void
			remove(): void
			showCaughtError(): void
			timings(): { reads: number; mountStarted: number; setupMs: number }
			evidence(): {
				reads: number
				cache: string[]
				graph: string
				members: string[]
				mountStarted: number
				setupMs: number
			}
		}
	}
}
window.ecologyFixture = {
	timings: () => ({ reads, mountStarted, setupMs }),
	mount,
	change: () => {
		change()
	},
	remove: () => {
		remove()
	},
	showCaughtError: () => {
		brokenAtom ??= app.atom<Loadable<number | Error>, Error>({
			key: `broken`,
			default: 0,
			catch: [Error],
		})
		const request = Promise.withResolvers<number>()
		app.setState(
			brokenAtom,
			request.promise.catch((error: Error) => error),
		)
		request.reject(new Error(`fixture error`))
	},
	evidence: () => ({
		reads,
		cache: [...app.store.valueMap.keys()].filter(
			(key) => !key.startsWith(`🔍 `),
		),
		graph: JSON.stringify(app.store.selectorGraph.toJSON()),
		members: [...app.store.atoms.keys()].filter((key) => !key.startsWith(`🔍 `)),
		mountStarted,
		setupMs,
	}),
}
mount(`small`)
