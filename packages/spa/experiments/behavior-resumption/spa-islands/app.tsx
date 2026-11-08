import { type Component, useGetter, useSetter } from "@atom.io/spa"
import type { RegularAtomFamilyToken, RegularAtomToken } from "atom.io"
import type { RootStore } from "atom.io/internal"
import {
	createRegularAtom,
	createRegularAtomFamily,
	isRootStore,
	Store,
} from "atom.io/internal"

import { initial, label, type Props, setupCount } from "../common.ts"

// A single store and family definition is shared by the eager header and all cards.
export function createApp(props: Props): {
	store: RootStore
	Header: Component
	Card: Component<{ id: number }>
} {
	const store = new Store({
		name: `benchmark-islands`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	if (!isRootStore(store)) throw new Error(`Expected an independent root store`)
	const quantities: RegularAtomFamilyToken<number, number> =
		createRegularAtomFamily(store, {
			key: `quantity`,
			default: (id: number) => initial(id),
		})
	const cart: RegularAtomToken<number> = createRegularAtom(
		store,
		{ key: `cart`, default: 0 },
		undefined,
	)
	function Header() {
		setupCount()
		const getCart = useGetter(cart)
		return (
			<>
				<h1>Small Things Store</h1>
				<p>Useful everyday objects, made to last.</p>
				<p>
					Bag: <strong id="cart">{getCart()}</strong>
				</p>
			</>
		)
	}
	function Card(p: { id: number }) {
		setupCount()
		const id = p.id
		const title = props.precomputed ? props.labels![id] : label(id, props.work)
		const get = useGetter(quantities, id),
			set = useSetter(quantities, id),
			setCart = useSetter(cart)
		return (
			<>
				<h2>{title}</h2>
				<p>Thoughtfully made. Ships free.</p>
				<button
					data-product={id}
					onClick={() => {
						set((x) => x + 1)
						setCart((x) => x + 1)
					}}
				>
					Add to bag: <span data-quantity={id}>{get()}</span>
				</button>
			</>
		)
	}
	return { store, Header, Card }
}
