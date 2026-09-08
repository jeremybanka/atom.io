import type { RootStore } from "atom.io/internal"
import { IMPLICIT, runtimeContext } from "atom.io/internal"
import type { Context, FlowProps, JSX } from "solid-js"
import { createContext } from "solid-js"

export const StoreContext: Context<RootStore> = runtimeContext(
	`solid/store`,
	() => createContext(IMPLICIT.STORE),
)

export function StoreProvider({
	children,
	store = IMPLICIT.STORE,
}: FlowProps<{
	store?: RootStore
}>): JSX.Element {
	return StoreContext.Provider({ value: store, children })
}
