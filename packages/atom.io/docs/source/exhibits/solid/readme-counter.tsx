/** @jsxImportSource solid-js */
import { useO } from "@atom.io/solid"
import { atom, setState } from "atom.io"
import type { JSX } from "solid-js"

const countAtom = atom<number>({ key: `count`, default: 0 })

export function Counter(): JSX.Element {
	const count = useO(countAtom)
	return (
		<button
			type="button"
			onClick={() => {
				setState(countAtom, (value) => value + 1)
			}}
		>
			Count: {count()}
		</button>
	)
}
