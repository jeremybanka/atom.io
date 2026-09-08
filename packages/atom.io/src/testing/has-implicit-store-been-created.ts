import { RUNTIME } from "atom.io/internal"

/**
 * Check whether the implicit store has been initialized without creating it.
 */
export function hasImplicitStoreBeenCreated(): boolean {
	return RUNTIME.implicitStore !== undefined
}
