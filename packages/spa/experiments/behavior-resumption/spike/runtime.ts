import { type BehaviorStats, createBehaviorScope } from "../host/scope.ts"
import { createAtomState } from "./atom-state.ts"

interface Stats extends BehaviorStats {
	stores: number
}
declare global {
	interface Window {
		__resumeStats?: Stats
	}
}
// Fixture composition only. No store, atom or DOM scan until a handler captures state.
const stats: Stats = {
	stores: 0,
	cells: 0,
	bindings: 0,
	handlerCalls: 0,
	domWrites: 0,
}
window.__resumeStats = stats
const owner = createBehaviorScope(
	document,
	createAtomState(() => {
		stats.stores++
	}),
	stats,
)
export const capture = owner.capture
// Document ownership only; Astro navigation/private-island integration is not implemented.
const pagehide = (event: PageTransitionEvent) => {
	if (event.persisted) return
	window.removeEventListener(`pagehide`, pagehide)
	owner.dispose()
}
window.addEventListener(`pagehide`, pagehide)
