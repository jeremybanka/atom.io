import { useI, useO } from "@atom.io/react"
import { atom } from "atom.io"
import type { JSX } from "react"

const countAtom = atom<number>({ key: `count`, default: 0 })

export default function Counter(): JSX.Element {
	const count = useO(countAtom)
	const setCount = useI(countAtom)
	const reset = () => {
		setCount(0)
	}
	return (
		<fieldset>
			<legend>Counter</legend>
			<label>
				Count
				<input
					type="number"
					value={count}
					onChange={(event) => {
						setCount(Number(event.currentTarget.value))
					}}
				/>
			</label>
			<div role="group" aria-label="Counter controls">
				<button
					type="button"
					onClick={() => {
						setCount((value) => value - 1)
					}}
				>
					Subtract
				</button>
				<button
					type="button"
					onClick={() => {
						setCount((value) => value + 1)
					}}
				>
					Add
				</button>
				<button type="button" onClick={reset}>
					Reset
				</button>
			</div>
		</fieldset>
	)
}
