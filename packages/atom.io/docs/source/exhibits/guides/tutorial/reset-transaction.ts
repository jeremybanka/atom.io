import type { AtomToken, RegularAtomFamilyToken } from "atom.io"
import { runTransaction, transaction } from "atom.io"

declare const pathKeysAtom: AtomToken<string[]>
declare const subpathKeysAtoms: RegularAtomFamilyToken<string[], string>
declare const preactLogoAtom: AtomToken<Promise<string>>

// @exhibit-region start reset-transaction
const resetTX = transaction<() => Promise<void>>({
	key: `reset`,
	do: async ({ get, reset, set }) => {
		const logo = await get(preactLogoAtom)
		for (const pathKey of get(pathKeysAtom)) {
			reset(subpathKeysAtoms, pathKey)
		}
		reset(pathKeysAtom)

		// parse the SVG and rebuild all the related atoms
		set(pathKeysAtom, [`path0`, `path1`, `path2`])
	},
})

const reset = runTransaction(resetTX)
// @exhibit-region end reset-transaction
