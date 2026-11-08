import type { SpaElement } from "@atom.io/spa"
import { useRef } from "@atom.io/spa"
import { atom } from "atom.io"

export const searchFieldAtom = atom<HTMLInputElement | null>({
	key: `searchField`,
	default: null,
})

export function SearchField(): SpaElement {
	const attachSearchField = useRef(searchFieldAtom)
	return (
		<input ref={attachSearchField} type="search" aria-label="Search products" />
	)
}
