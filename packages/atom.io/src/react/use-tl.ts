import type { TimelineToken } from "atom.io"
import {
	clearTimelineInStore,
	inspectTimelineInStore,
	subscribeToTimeline,
	timeTravel,
} from "atom.io/internal"
import { useContext, useId, useRef, useSyncExternalStore } from "react"

import { StoreContext } from "./store-context.tsx"

export type TimelineMeta = {
	at: number
	length: number
	undo: () => void
	redo: () => void
	clear: () => void
}

export function useTL(token: TimelineToken<any>): TimelineMeta {
	const store = useContext(StoreContext)
	const id = useId()
	const tokenRef = useRef(token)
	const rebuildMeta = () => {
		const { at, length } = inspectTimelineInStore(store, token)
		return {
			at,
			length,
			undo: () => {
				timeTravel(store, `undo`, token)
			},
			redo: () => {
				timeTravel(store, `redo`, token)
			},
			clear: () => {
				clearTimelineInStore(store, token)
			},
		}
	}
	const meta = useRef<TimelineMeta>(rebuildMeta())
	const retrieve = () => {
		const { at, length } = inspectTimelineInStore(store, token)
		if (
			meta.current.at !== at ||
			meta.current.length !== length ||
			tokenRef.current !== token
		) {
			tokenRef.current = token
			meta.current = rebuildMeta()
		}
		return meta.current
	}
	return useSyncExternalStore<TimelineMeta>(
		(dispatch) => subscribeToTimeline(store, token, `use-tl:${id}`, dispatch),
		retrieve,
		retrieve,
	)
}
