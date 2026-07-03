import { atom } from "atom.io"
import { useI, useO } from "atom.io/react"

const toggleAtom = atom<boolean>({
	key: `toggle`,
	default: false,
})

// DOCS REVIEW: This component is named `UrlDisplay`, but the example is a
// checkbox toggle. Should the name match the behavior to reduce skim friction?
function UrlDisplay() {
	const setToggle = useI(toggleAtom)
	const toggle = useO(toggleAtom)
	return (
		<input
			type="checkbox"
			checked={toggle}
			onChange={() => {
				setToggle((t) => !t)
			}}
		/>
	)
}
