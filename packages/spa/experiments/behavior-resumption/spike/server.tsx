import { useGetter } from "@atom.io/spa"
import { renderToString } from "@atom.io/spa/server"
import type { RegularAtomToken } from "atom.io"
import {
	createRegularAtom,
	getFromStore,
	isRootStore,
	Store,
} from "atom.io/internal"

import { label, type Props } from "../common.ts"
import type { CellSnapshot } from "./schema.ts"

type SpikeProps = Props & { initialQuantity?: number; initialCart?: number }

/** This is the actual PR's compiler/SSR and actual atom.io state, not hand-built HTML. */
export function render(props: SpikeProps): { html: string; setups: number } {
	if (
		![props.initialQuantity ?? 0, props.initialCart ?? 0].every(Number.isFinite)
	)
		throw new Error(`resume: expected finite initial values`)
	if (typeof window !== `undefined`)
		throw new Error(`Server component setup ran in browser`)
	const store = new Store({
		name: `resume-spike-ssr`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	if (!isRootStore(store)) throw new Error(`Expected an independent root store`)
	const cart: RegularAtomToken<number> = createRegularAtom(
		store,
		{ key: `cart`, default: props.initialCart ?? 0 },
		undefined,
	)
	const quantity: RegularAtomToken<number>[] = Array.from(
		{ length: props.count },
		(_, id) =>
			createRegularAtom(
				store,
				{ key: `q${id}`, default: props.initialQuantity ?? 0 },
				undefined,
			),
	)
	let setups = 0

	function Snapshot(p: { id: string; value: number; text: string[] }) {
		const snapshot: CellSnapshot = { version: 1, value: p.value, text: p.text }
		return (
			<script type="application/json" id={`resume-state-${p.id}`}>
				{JSON.stringify(snapshot)}
			</script>
		)
	}

	function Card(p: { id: number }) {
		setups++
		const id = p.id
		const get = useGetter(quantity[id])
		const title = props.precomputed ? props.labels![id] : label(id, props.work)
		return (
			<article>
				<h2>{title}</h2>
				<p>Thoughtfully made. Ships free.</p>
				<button
					type="button"
					data-product={id}
					data-resume-click="/resume/cart.js#addToBag"
					data-resume-capture={JSON.stringify([`q${id}`, `cart`])}
				>
					Add to bag:{` `}
					<span id={`quantity-${id}`} data-quantity={id}>
						{get()}
					</span>
				</button>
				<Snapshot
					id={`q${id}`}
					value={getFromStore(store, quantity[id])}
					text={[`quantity-${id}`]}
				/>
			</article>
		)
	}

	function App() {
		setups++
		const getCart = useGetter(cart)
		return (
			<main>
				<header>
					<h1>Small Things Store</h1>
					<p>Useful everyday objects, made to last.</p>
					<p>
						Bag: <strong id="cart">{getCart()}</strong>
					</p>
				</header>
				<Snapshot id="cart" value={getFromStore(store, cart)} text={[`cart`]} />
				{props.below ? (
					<div class="spacer">Scroll for the collection</div>
				) : null}
				<section id="catalog">
					{Array.from({ length: props.count }, (_, id) => (
						<Card id={id} />
					))}
				</section>
			</main>
		)
	}

	const html = renderToString(() => <App />, { store, idPrefix: `resume-spike` })
	return { html, setups }
}
