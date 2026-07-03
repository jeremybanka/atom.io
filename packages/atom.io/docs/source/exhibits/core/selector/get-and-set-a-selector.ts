import { getState, setState } from "atom.io"

import {
	dividendAtom,
	divisorAtom,
	quotientSelector,
} from "./declare-a-selector.ts"

// DOCS REVIEW: The exhibit name says "get and set a selector", but this only
// sets a dependency atom. Should we demonstrate a writable selector's `set`
// callback here, or rename the exhibit to avoid implying selectors are set in
// this example?
getState(dividendAtom) // -> 0
getState(divisorAtom) // -> 2
getState(quotientSelector) // -> 0

setState(dividendAtom, 4)

getState(quotientSelector) // -> 2
