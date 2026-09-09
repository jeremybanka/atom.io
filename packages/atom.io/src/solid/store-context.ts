import type { RootStore } from "atom.io/internal"
import { IMPLICIT } from "atom.io/internal"
import type { Context, FlowProps, JSX } from "solid-js"
import { createContext } from "solid-js"

declare global {
	var ATOM_IO_SOLID_STORE_CONTEXT: Context<RootStore> | undefined
}

// Reuse the context across physical package copies, like the implicit store.
export const StoreContext: Context<RootStore> =
	(globalThis.ATOM_IO_SOLID_STORE_CONTEXT ??= createContext(IMPLICIT.STORE))

export function StoreProvider({
	children,
	store = IMPLICIT.STORE,
}: FlowProps<{
	store?: RootStore
}>): JSX.Element {
	return StoreContext.Provider({ value: store, children })
}
