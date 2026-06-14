import { SetOverlay } from "atom.io/foundations/overlays"

const source = new Set([`a`, `b`])
const overlay = new SetOverlay(source)

overlay.clear()
overlay.add(`x`)
overlay.add(`a`)

Array.from(overlay) // ["x", "a"]
overlay.deleted // Set { "b" }
Array.from(source) // ["a", "b"]
