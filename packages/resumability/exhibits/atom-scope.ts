import type { RootStore } from "atom.io/internal"
import { createResumption } from "resumability/client"

// Run once when initializing a browser store; register the returned cleanup
// with its owner. Definitions remain shared, while each store has its own scope.
export function resumeDefaults(store: RootStore, wrapper: Element): () => void {
	const scope = createResumption(wrapper)
	store.runDefault = scope.run
	return scope.dispose
}
