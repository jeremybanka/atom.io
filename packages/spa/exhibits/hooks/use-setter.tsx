import type { SpaElement } from "@atom.io/spa"
import { useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

export const searchQueryAtom = atom<string>({ key: `searchQuery`, default: `` })

export function SearchBox(): SpaElement {
	const setSearchQuery = useSetter(searchQueryAtom)
	return (
		<input
			type="search"
			aria-label="Search products"
			onInput={(event) => {
				setSearchQuery(event.currentTarget.value)
			}}
		/>
	)
}
