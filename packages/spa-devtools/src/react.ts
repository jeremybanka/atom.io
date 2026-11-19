import { StoreContext } from "@atom.io/react"
import type { ReactElement } from "react"
import { createElement, useContext, useEffect, useRef } from "react"

import type { AtomIODevtoolsProps } from "./mount.ts"
import { mountAtomIODevtools } from "./mount.ts"

export type { AtomIODevtoolsProps } from "./mount.ts"

/** The shared SPA debugger, following the React store provider unless overridden. */
export function AtomIODevtools({
	store: explicitStore,
	stores,
	hideByDefault = false,
}: AtomIODevtoolsProps): ReactElement {
	const providerStore = useContext(StoreContext)
	const store = stores?.length ? undefined : (explicitStore ?? providerStore)
	const host = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const panel = mountAtomIODevtools(
			host.current!,
			store ? { store, hideByDefault } : { stores: stores!, hideByDefault },
		)
		return panel.dispose
	}, [store, stores, hideByDefault])
	return createElement(`div`, { ref: host })
}
