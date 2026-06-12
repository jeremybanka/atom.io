import type { AtomUpdateEvent } from "atom.io"

import { setIntoStore } from "../set-state/index.ts"
import type { Store } from "../store/index.ts"

export function ingestAtomUpdateEvent(
	store: Store,
	event: AtomUpdateEvent<any>,
	applying: `newValue` | `oldValue`,
): void {
	const {
		token,
		update: { newValue, oldValue },
	} = event
	const value = applying === `newValue` ? newValue : oldValue
	setIntoStore(store, token, value)
}
