import { timeline } from "atom.io"

import { xAtoms, yAtoms } from "../families/declare-a-family.tsx"

export const coordinatesTL = timeline({
	key: `timeline`,
	scope: [xAtoms, yAtoms],
})
