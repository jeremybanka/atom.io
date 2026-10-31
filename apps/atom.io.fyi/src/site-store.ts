import type { RootStore } from "atom.io/internal"
import { IMPLICIT, setIntoStore, Store } from "atom.io/internal"

import {
	headingsAtom,
	pathnameAtom,
	visibleHeadingIdsAtom,
} from "./navigation-state.ts"

/** Independent SSR requests; one inspectable application store in the browser. */
export function createSiteStore(props: { pathname?: string }): RootStore {
	const store =
		typeof window === `undefined`
			? (new Store(
					{ name: `atom.io.fyi`, lifespan: `ephemeral`, isProduction: true },
					IMPLICIT.STORE,
				) as RootStore)
			: IMPLICIT.STORE
	if (props.pathname !== undefined) {
		setIntoStore(store, pathnameAtom, props.pathname)
		setIntoStore(store, headingsAtom, [])
		setIntoStore(store, visibleHeadingIdsAtom, [])
	}
	return store
}
