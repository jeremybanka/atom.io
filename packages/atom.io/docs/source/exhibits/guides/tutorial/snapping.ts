import { atomFamily, setState } from "atom.io"

type PointXY = { x: number; y: number }
type EdgeXY = { c?: PointXY; s: PointXY }

const WIDTH = 256
const HEIGHT = 296

const nodeAtoms = atomFamily<PointXY | null, string>({
	key: `node`,
	default: null,
})
const edgeAtoms = atomFamily<EdgeXY | boolean, string>({
	key: `edge`,
	default: true,
})

function clamp(n: number, min: number, max: number) {
	return Math.max(min, Math.min(max, n))
}

// @exhibit-region start snap-helper
function snap(n: number, size: number) {
	return Math.round(n / size) * size
}
// @exhibit-region end snap-helper

declare const pt: { matrixTransform(matrix: unknown): PointXY }
declare const ctm: unknown
declare const draggingBy: `s` | undefined
declare const currentlyDragging: string

// @exhibit-region start snap-before-writing-state
const { x, y } = pt.matrixTransform(ctm)
const snappedX = snap(x, 8)
const snappedY = snap(y, 8)

switch (draggingBy) {
	case undefined:
		setState(nodeAtoms, currentlyDragging, {
			x: clamp(snappedX, -185, WIDTH + 185),
			y: clamp(snappedY, -10, HEIGHT + 10),
		})
		break
	case `s`:
		setState(edgeAtoms, currentlyDragging, (prev) => ({
			...(prev as EdgeXY),
			s: {
				x: clamp(snappedX, -185, WIDTH + 185),
				y: clamp(snappedY, -10, HEIGHT + 10),
			},
		}))
		break
}
// @exhibit-region end snap-before-writing-state
