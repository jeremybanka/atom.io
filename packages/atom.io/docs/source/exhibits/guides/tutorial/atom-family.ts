import { atomFamily } from "atom.io"

type PointXY = { x: number; y: number }

// @exhibit-region start atom-family
const nodeAtoms = atomFamily<PointXY | null, string>({
	key: `node`,
	default: null,
})
// @exhibit-region end atom-family
