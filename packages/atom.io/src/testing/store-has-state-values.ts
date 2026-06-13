import type { RootStore } from "atom.io/internal"
import { IMPLICIT } from "atom.io/internal"

/**
 * Check whether a store currently retains any state values.
 *
 * Useful for asserting that a failed transaction did not commit values, while
 * keeping tests away from the store's internal value containers.
 */
export function storeHasStateValues(store: RootStore = IMPLICIT.STORE): boolean {
	return store.valueMap.size > 0
}
