import type { RootStore } from "atom.io/internal"
import { IMPLICIT } from "atom.io/internal"
import type { Context, FlowProps, JSX } from "solid-js"
import { createContext } from "solid-js"

declare global {
	var ATOM_IO_SOLID_STORE_CONTEXTS:
		| WeakMap<typeof createContext, Context<RootStore>>
		| undefined
}

// The factory identifies the Solid instance that owns the context's provider.
const storeContexts = (globalThis.ATOM_IO_SOLID_STORE_CONTEXTS ??= new WeakMap())
export const StoreContext: Context<RootStore> =
	storeContexts.get(createContext) ?? createContext(IMPLICIT.STORE)
storeContexts.set(createContext, StoreContext)

export function StoreProvider({
	children,
	store = IMPLICIT.STORE,
}: FlowProps<{
	store?: RootStore
}>): JSX.Element {
	return StoreContext.Provider({ value: store, children })
}
