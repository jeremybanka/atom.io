import { useI, useLoadable, useO } from "@atom.io/react"
import { atom, atomFamily, type Loadable, setState } from "atom.io"

import { debounce } from "./helpers.ts"
import { type Product, searchProducts } from "./services.ts"
import { SearchForm } from "./views.tsx"

const settledQueryAtom = atom<string>({
	key: `settledQuery`,
	default: ``,
})
const queryAtom = atom<string>({
	key: `query`,
	default: ``,
	effects: [
		({ onSet }) => {
			const settle = debounce(
				(query: string) => setState(settledQueryAtom, query),
				300,
			)
			onSet(({ newValue }) => settle(newValue))
			return settle.cancel
		},
	],
})
const resultAtoms = atomFamily<Loadable<Product[]>, string, Error>({
	key: `result`,
	default: searchProducts,
	catch: [Error],
})
export function Search() {
	const query = useO(queryAtom)
	const settledQuery = useO(settledQueryAtom)
	const setQuery = useI(queryAtom)
	const results = useLoadable(resultAtoms, settledQuery, [])
	return (
		<SearchForm
			query={query}
			onChange={setQuery}
			results={results.value}
			failed={Boolean(results.error)}
		/>
	)
}
