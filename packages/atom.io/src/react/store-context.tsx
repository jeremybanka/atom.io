import type { RootStore } from "atom.io/internal"
import { IMPLICIT } from "atom.io/internal"
import { createContext } from "react"

declare global {
	var ATOM_IO_REACT_STORE_CONTEXT: React.Context<RootStore> | undefined
}

// Reuse the context across physical package copies, like the implicit store.
export const StoreContext: React.Context<RootStore> =
	(globalThis.ATOM_IO_REACT_STORE_CONTEXT ??= createContext(IMPLICIT.STORE))

export const StoreProvider: React.FC<{
	children: React.ReactNode
	store?: RootStore
}> = ({ children, store = IMPLICIT.STORE }) => (
	<StoreContext.Provider value={store}>{children}</StoreContext.Provider>
)
