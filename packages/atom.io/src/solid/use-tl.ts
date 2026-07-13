import type { TimelineFamilyToken, TimelineToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import {
	arbitrary,
	clearTimelineInStore,
	findTimelineInStore,
	inspectTimelineInStore,
	subscribeToTimeline,
	timeTravel,
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

export function useTL(token: TimelineToken<any>): () => TimelineMeta
export function useTL<K extends Canonical>(
	family: TimelineFamilyToken<K, any>,
	key: NoInfer<K>,
): () => TimelineMeta
export function useTL<K extends Canonical>(
	...params:
		| [token: TimelineToken<any>]
		| [family: TimelineFamilyToken<K, any>, key: NoInfer<K>]
): () => TimelineMeta {
	const store = useContext(StoreContext)
	const token =
		params.length === 1
			? params[0]
			: findTimelineInStore(store, params[0], params[1])
	const id = arbitrary()
	const getSnapshot = (): TimelineMeta => {
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
	return useSyncExternalStore<TimelineMeta>((dispatch) => {
		return subscribeToTimeline(store, token, `use-tl:${id}`, dispatch)
	}, getSnapshot)
}
