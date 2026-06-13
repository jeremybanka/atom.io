/**
 * Check whether the implicit store has been initialized without creating it.
 */
export function hasImplicitStoreBeenCreated(): boolean {
	return globalThis.ATOM_IO_IMPLICIT_STORE !== undefined
}
