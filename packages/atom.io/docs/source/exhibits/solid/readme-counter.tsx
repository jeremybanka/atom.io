/** @jsxImportSource @solidjs/web */
import { useO } from "@atom.io/solid"
import type { JSX } from "@solidjs/web"
import { atom, setState } from "atom.io"

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
