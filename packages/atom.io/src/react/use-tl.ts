import type { TimelineFamilyToken, TimelineToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import {
	clearTimelineInStore,
	findTimelineInStore,
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

export function useTL(token: TimelineToken<any>): TimelineMeta
export function useTL<K extends Canonical>(
	family: TimelineFamilyToken<K, any>,
	key: NoInfer<K>,
): TimelineMeta
export function useTL<K extends Canonical>(
	...params:
		| [token: TimelineToken<any>]
		| [family: TimelineFamilyToken<K, any>, key: NoInfer<K>]
): TimelineMeta {
	const store = useContext(StoreContext)
	const token =
		params.length === 1
			? params[0]
			: findTimelineInStore(store, params[0], params[1])
	const id = useId()
	const storeRef = useRef(store)
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
			storeRef.current !== store ||
			tokenRef.current.key !== token.key
		) {
			storeRef.current = store
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
