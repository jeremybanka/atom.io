import type { TimelineToken } from "atom.io"

import type { Store } from "../store/index.ts"
import { withdraw } from "../store/index.ts"

export type TimelineInspection = {
	at: number
	length: number
}

export function inspectTimelineInStore(
	store: Store,
	token: TimelineToken<any>,
): TimelineInspection {
	const timeline = withdraw(store, token)
	return {
		at: timeline.at,
		length: timeline.history.length,
	}
}
