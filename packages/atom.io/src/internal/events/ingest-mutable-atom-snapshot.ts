import type { MutableAtomSnapshotEvent } from "atom.io"

import { getJsonTokenFromStore } from "../mutable/index.ts"
import { setIntoStore } from "../set-state/index.ts"
import type { Store } from "../store/index.ts"
import { applyMutableSnapshot } from "../transaction/transaction-notification-batch.ts"

export function ingestMutableAtomSnapshotEvent(
	store: Store,
	event: MutableAtomSnapshotEvent,
	applying: `newValue` | `oldValue`,
): void {
	applyMutableSnapshot(store, () => {
		setIntoStore(
			store,
			getJsonTokenFromStore(store, event.token),
			event.update[applying],
		)
	})
}
