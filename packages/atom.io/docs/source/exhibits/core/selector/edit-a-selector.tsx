import { useI, useO } from "@atom.io/react"
import { setState } from "atom.io"
import type { JSX } from "react"

import {
	dividendAtom,
	divisorAtom,
	quotientSelector,
} from "./declare-a-selector.ts"

setState(dividendAtom, 12)

export default function Division(): JSX.Element {
	const divisor = useO(divisorAtom)
	const increase = useI(divisorAtom)
	const quotient = useO(quotientSelector)

	return (
		<fieldset>
			<legend>Divide 12</legend>
			<p>Divisor: {divisor}</p>
			<p>Quotient: {quotient}</p>
			<button
				type="button"
				onClick={() => {
					increase((value) => value + 1)
				}}
			>
				Increase divisor
			</button>
		</fieldset>
	)
}
