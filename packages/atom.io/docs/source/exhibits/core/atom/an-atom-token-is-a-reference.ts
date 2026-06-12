import { getState } from "atom.io"

import { countAtom } from "./declare-an-atom.ts"

countAtom // -> { key: `count`, type: `atom` }
getState(countAtom) // -> 0
getState({ key: `count`, type: `atom` }) // -> 0
