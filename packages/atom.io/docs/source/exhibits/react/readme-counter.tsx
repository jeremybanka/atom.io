import { useO } from "@atom.io/react"
import { atom, setState } from "atom.io"
import type { ReactNode } from "react"

const countAtom = atom<number>({ key: `count`, default: 0 })

export function Counter(): ReactNode {
	const count = useO(countAtom)
	return (
		<button
			type="button"
			onClick={() => {
				setState(countAtom, (value) => value + 1)
			}}
		>
			Count: {count}
		</button>
	)
}
