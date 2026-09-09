import type { RootStore } from "atom.io/internal"
import { IMPLICIT } from "atom.io/internal"
import { createContext } from "react"

declare global {
	var ATOM_IO_REACT_STORE_CONTEXTS:
		| WeakMap<typeof createContext, React.Context<RootStore>>
		| undefined
}

// The factory identifies a React instance even across module interop wrappers.
const storeContexts = (globalThis.ATOM_IO_REACT_STORE_CONTEXTS ??= new WeakMap())
export const StoreContext: React.Context<RootStore> =
	storeContexts.get(createContext) ?? createContext(IMPLICIT.STORE)
storeContexts.set(createContext, StoreContext)

export const StoreProvider: React.FC<{
	children: React.ReactNode
	store?: RootStore
}> = ({ children, store = IMPLICIT.STORE }) => (
	<StoreContext.Provider value={store}>{children}</StoreContext.Provider>
)
