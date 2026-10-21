import type { RegularAtomFamilyToken } from "atom.io"
import { atomFamily } from "atom.io"

export const letterAtoms: RegularAtomFamilyToken<string | null, number> =
	atomFamily({
		key: `letter`,
		default: null,
	})
