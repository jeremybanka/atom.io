import type { VNode } from "@atom.io/spa"
import { useGetter } from "@atom.io/spa"
import { atom } from "atom.io"

export const cartCountAtom = atom<number>({ key: `cartCount`, default: 0 })

export function CartCount(): VNode {
	const getCartCount = useGetter(cartCountAtom)
	return <output aria-label="Items in cart">{getCartCount()}</output>
}
