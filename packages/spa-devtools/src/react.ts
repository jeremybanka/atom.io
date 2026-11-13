import { StoreContext } from "@atom.io/react"
import type { ReactElement } from "react"
import { createElement, useContext, useEffect, useRef } from "react"

import type { AtomIODevtoolsProps } from "./AtomIODevtools.tsx"
import { mountAtomIODevtools } from "./AtomIODevtools.tsx"

export type { AtomIODevtoolsProps } from "./AtomIODevtools.tsx"

/** The shared SPA debugger, following the React store provider unless overridden. */
export function AtomIODevtools({
	store: explicitStore,
	hideByDefault = false,
}: AtomIODevtoolsProps): ReactElement {
	const providerStore = useContext(StoreContext)
	const store = explicitStore ?? providerStore
	const host = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const panel = mountAtomIODevtools(host.current!, { store, hideByDefault })
		return panel.dispose
	}, [store, hideByDefault])
	return createElement(`div`, { ref: host })
}
