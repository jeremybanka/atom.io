import type { SpaElement } from "@atom.io/spa"
import { onCleanup, useDisposal, useGetter, useSetter } from "@atom.io/spa"
import { atomFamily } from "atom.io"

export const menuOpenAtoms = atomFamily<boolean, string>({
	key: `menuOpen`,
	default: false,
})

export function MenuToggle(props: { id: string }): SpaElement {
	const id = props.id
	const getMenuOpen = useGetter(menuOpenAtoms, id)
	const setMenuOpen = useSetter(menuOpenAtoms, id)
	const dispose = useDisposal()
	onCleanup(() => {
		dispose(menuOpenAtoms, id)
	})
	return (
		<button
			aria-expanded={getMenuOpen()}
			onClick={() => {
				setMenuOpen((open) => !open)
			}}
		>
			{getMenuOpen() ? `Close menu` : `Open menu`}
		</button>
	)
}
