import { timeline } from "atom.io"

import { xAtoms, yAtoms } from "../families/declare-a-family.tsx"

export const coordinatesTimeline = timeline({
	key: `coordinates`,
	scope: [xAtoms, yAtoms],
})
