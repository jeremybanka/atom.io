import { useI, useO } from "@atom.io/react"
import { atom } from "atom.io"
import type { ReactNode } from "react"

// If this is application-owned state, make the atom its source of truth.
const countAtom = atom<number>({ key: `count`, default: 0 })
export function Counter(): ReactNode {
	const count = useO(countAtom)
	const setCount = useI(countAtom)
	return (
		<button
			type="button"
			onClick={() => {
				setCount((value) => value + 1)
			}}
		>
			{count}
		</button>
	)
}
