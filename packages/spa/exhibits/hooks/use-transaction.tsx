import type { VNode } from "@atom.io/spa"
import { useTransaction } from "@atom.io/spa"
import { atom, transaction } from "atom.io"

export const cartItemsAtom = atom<string[]>({ key: `cartItems`, default: [] })
export const cartOpenAtom = atom<boolean>({ key: `cartOpen`, default: false })
const addToCartTransaction = transaction<(sku: string) => void>({
	key: `addToCart`,
	do: ({ get, set }, sku) => {
		set(cartItemsAtom, [...get(cartItemsAtom), sku])
		set(cartOpenAtom, true)
	},
})

export function AddToCart(props: { sku: string }): VNode {
	const addToCart = useTransaction(addToCartTransaction)
	return (
		<button
			onClick={() => {
				addToCart(props.sku)
			}}
		>
			Add to cart
		</button>
	)
}
