import { timeline } from "atom.io"

import { pointAtoms } from "../families/declare-a-family.tsx"

export const coordinatesTimeline = timeline({
	key: `coordinates`,
	scope: [pointAtoms],
})
