import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

const countAtom = atom<number>({ key: `count`, default: 0 })

export default function Counter(): SpaElement {
	const getCount = useGetter(countAtom)
	const setCount = useSetter(countAtom)
	return (
		<button
			onClick={() => {
				setCount((count) => count + 1)
			}}
		>
			Count: {getCount()}
		</button>
	)
}
