import { subscribe } from "atom.io"

import { countAtom } from "./declare-an-atom.ts"

subscribe(countAtom, (count) => {
	console.log(`count is now ${count.newValue}`)
})
