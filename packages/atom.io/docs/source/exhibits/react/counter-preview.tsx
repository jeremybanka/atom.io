import { useI, useO } from "@atom.io/react"
import { atom } from "atom.io"
import type { JSX } from "react"

const countAtom = atom<number>({ key: `count`, default: 0 })

export default function Counter(): JSX.Element {
	const count = useO(countAtom)
	const setCount = useI(countAtom)

	return (
		<fieldset>
			<legend>Counter</legend>
			<label htmlFor="count">Count </label>
			<input
				id="count"
				type="number"
				value={count}
				onChange={(event) => setCount(Number(event.currentTarget.value))}
			/>
			<p>
				<button type="button" onClick={() => setCount((value) => value - 1)}>
					Subtract
				</button>
				{` `}
				<button type="button" onClick={() => setCount((value) => value + 1)}>
					Add
				</button>
				{` `}
				<button type="button" onClick={() => setCount(0)}>
					Reset
				</button>
			</p>
		</fieldset>
	)
}
