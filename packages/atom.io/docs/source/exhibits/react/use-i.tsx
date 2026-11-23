import { useI, useO } from "@atom.io/react"
import { atom } from "atom.io"

const toggleAtom = atom<boolean>({
	key: `toggle`,
	default: false,
})

export default function ToggleInput(): React.JSX.Element {
	const setToggle = useI(toggleAtom)
	const toggle = useO(toggleAtom)
	return (
		<label>
			<input
				type="checkbox"
				checked={toggle}
				onChange={() => {
					setToggle((t) => !t)
				}}
			/>
			Toggle setting
		</label>
	)
}
