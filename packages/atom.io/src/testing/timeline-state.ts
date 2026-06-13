import type { TimelineToken } from "atom.io"
import type { RootStore } from "atom.io/internal"
import { IMPLICIT, withdraw } from "atom.io/internal"

export type TimelineState = {
	at: number
	length: number
}

/**
 * Read a timeline's current history position.
 */
export function timelineState(
	token: TimelineToken<any>,
	store: RootStore = IMPLICIT.STORE,
): TimelineState {
	const timeline = withdraw(store, token)
	return {
		at: timeline.at,
		length: timeline.history.length,
	}
}
