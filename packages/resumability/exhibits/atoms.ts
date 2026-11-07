import { atom, type Loadable } from "atom.io"

import { warehouseName } from "./constant.ts"

export const warehouseNameAtom = atom<Loadable<string>>({
	key: `warehouseName`,
	default: warehouseName,
})
