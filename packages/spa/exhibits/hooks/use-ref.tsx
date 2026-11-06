import type { VNode } from "@atom.io/spa"
import { useRef } from "@atom.io/spa"
import { atom } from "atom.io"

export const searchFieldAtom = atom<HTMLInputElement | null>({
	key: `searchField`,
	default: null,
})

export function SearchField(): VNode {
	const attachSearchField = useRef(searchFieldAtom)
	return (
		<input ref={attachSearchField} type="search" aria-label="Search products" />
	)
}
