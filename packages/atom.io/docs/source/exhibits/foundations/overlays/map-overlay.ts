import { MapOverlay } from "atom.io/foundations/overlays"

const source = new Map([
	[`a`, 1],
	[`b`, 2],
])

const overlay = new MapOverlay(source)

overlay.set(`a`, 10)
overlay.set(`x`, 100)
overlay.delete(`b`)

Array.from(overlay) // [["a", 10], ["x", 100]]
source.get(`a`) // 1
