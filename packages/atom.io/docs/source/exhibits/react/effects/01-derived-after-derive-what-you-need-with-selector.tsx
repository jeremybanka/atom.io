import { useI, useO } from "@atom.io/react"
import { atom, selector } from "atom.io"
import type { ReactNode } from "react"

import type { Product } from "./services.ts"
import { SearchForm } from "./views.tsx"

export const productsAtom = atom<Product[]>({
	key: `products`,
	default: [],
})
const queryAtom = atom<string>({ key: `query`, default: `` })
const matchesSelector = selector<Product[]>({
	key: `matches`,
	get: ({ get }) =>
		get(productsAtom).filter((product) => product.name.includes(get(queryAtom))),
})
export function ProductSearch(): ReactNode {
	const query = useO(queryAtom)
	const setQuery = useI(queryAtom)
	const matches = useO(matchesSelector)
	return <SearchForm query={query} onChange={setQuery} results={matches} />
}
