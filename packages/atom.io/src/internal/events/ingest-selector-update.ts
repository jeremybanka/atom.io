import type {
	AtomCreationEvent,
	AtomOnly,
	AtomUpdateEvent,
	TimelineManageable,
	TimelineSelectorUpdateEvent,
} from "atom.io"

import type { Store } from "../store/index.ts"
import { ingestAtomUpdateEvent } from "./ingest-atom-update.ts"
import { ingestCreationEvent } from "./ingest-creation-disposal.ts"

export function ingestSelectorUpdateEvent(
	store: Store,
	selectorUpdate: TimelineSelectorUpdateEvent<any>,
	applying: `newValue` | `oldValue`,
): void {
	let updates: (
		| AtomUpdateEvent<AtomOnly<TimelineManageable>>
		| AtomCreationEvent<AtomOnly<TimelineManageable>>
	)[]
	if (applying === `newValue`) {
		updates = selectorUpdate.subEvents
	} else {
		updates = selectorUpdate.subEvents.toReversed()
	}
	for (const atomUpdate of updates) {
		if (atomUpdate.type === `atom_creation`) {
			ingestCreationEvent(store, atomUpdate, applying)
		} else {
			ingestAtomUpdateEvent(store, atomUpdate, applying)
		}
	}
}
