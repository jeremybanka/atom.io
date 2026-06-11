import type { AtomUpdateEvent } from "atom.io"

import { disposeFromStore } from "../families"
import { setIntoStore } from "../set-state"
import type { Store } from "../store"

export function ingestAtomUpdateEvent(
	store: Store,
	event: AtomUpdateEvent<any>,
	applying: `newValue` | `oldValue`,
): void {
	const { token, update } = event
	const { newValue, oldValue } = update
	if (applying === `oldValue` && !(`oldValue` in update) && token.family) {
		disposeFromStore(store, token)
		return
	}
	const value = applying === `newValue` ? newValue : oldValue
	setIntoStore(store, token, value)
}
