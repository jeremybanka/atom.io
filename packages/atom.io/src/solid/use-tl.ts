import type { TimelineToken } from "atom.io"
import { clearTimeline, redo, undo } from "atom.io"
import {
	arbitrary,
	inspectTimelineInStore,
	subscribeToTimeline,
} from "atom.io/internal"
import { useContext } from "solid-js"

import { StoreContext } from "./store-context.ts"
import { useSyncExternalStore } from "./use-sync-external-store-solid.ts"

export type TimelineMeta = {
	at: number
	length: number
	undo: () => void
	redo: () => void
	clear: () => void
}

export function useTL(token: TimelineToken<any>): () => TimelineMeta {
	const store = useContext(StoreContext)
	const id = arbitrary()
	const getSnapshot = (): TimelineMeta => {
		const { at, length } = inspectTimelineInStore(store, token)
		return {
			at,
			length,
			undo: () => {
				undo(token)
			},
			redo: () => {
				redo(token)
			},
			clear: () => {
				clearTimeline(token)
			},
		}
	}
	return useSyncExternalStore<TimelineMeta>((dispatch) => {
		return subscribeToTimeline(store, token, `use-tl:${id}`, dispatch)
	}, getSnapshot)
}
