import { MapOverlay } from "atom.io/foundations/overlays"

const source = new Map([
	[`a`, 1],
	[`b`, 2],
])

const overlay = new MapOverlay(source)

overlay.set(`b`, 20)
overlay.set(`c`, 3)

Array.from(overlay) // [["a", 1], ["b", 20], ["c", 3]]

overlay.delete(`a`)

Array.from(overlay) // [["b", 20], ["c", 3]]
Array.from(source) // [["a", 1], ["b", 2]]
