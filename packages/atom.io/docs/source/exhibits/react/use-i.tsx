import { useI, useO } from "@atom.io/react"
import { atom } from "atom.io"

const toggleAtom = atom<boolean>({
	key: `toggle`,
	default: false,
})

function ToggleInput() {
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
