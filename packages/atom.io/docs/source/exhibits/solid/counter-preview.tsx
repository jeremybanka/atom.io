/** @jsxImportSource @solidjs/web */
import { useI, useO } from "@atom.io/solid"
import type { JSX } from "@solidjs/web"
import { atom } from "atom.io"

const countAtom = atom<number>({ key: `count`, default: 0 })

export default function Counter(): JSX.Element {
	const count = useO(countAtom)
	const setCount = useI(countAtom)

	return (
		<fieldset>
			<legend>Counter</legend>
			<output>Count: {count()}</output>
			<div role="group" aria-label="Counter controls">
				<button
					type="button"
					onClick={() => {
						setCount((value) => value + 1)
					}}
				>
					Add
				</button>
				<button
					type="button"
					onClick={() => {
						setCount(0)
					}}
				>
					Reset
				</button>
			</div>
		</fieldset>
	)
}
