import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"

import { editCountAtom } from "./hmr-state.ts"

export function HotCounter(): SpaElement {
	const getEditCount = useGetter(editCountAtom)
	const setEditCount = useSetter(editCountAtom)
	return (
		<button
			onClick={() => {
				setEditCount((value) => value + 1)
			}}
		>
			{getEditCount()}
		</button>
	)
}
