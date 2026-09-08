import type { RootStore } from "atom.io/internal"
import { IMPLICIT, runtimeContext } from "atom.io/internal"
import { createContext } from "react"

export const StoreContext: React.Context<RootStore> = runtimeContext(
	`react/store`,
	() => createContext(IMPLICIT.STORE),
)

export const StoreProvider: React.FC<{
	children: React.ReactNode
	store?: RootStore
}> = ({ children, store = IMPLICIT.STORE }) => (
	<StoreContext.Provider value={store}>{children}</StoreContext.Provider>
)
