import type { TimelineFamilyToken, TimelineToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import {
	arbitrary,
	clearTimelineInStore,
	findTimelineInStore,
	getTimelineTransactionAtHead,
	inspectTimelineInStore,
	subscribeToTimeline,
	timeTravel,
	timeTravelTransactionGroupInStore,
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
	/** Undo the current transaction on every timeline where it is at the head. */
	undoTransaction?: () => void
	/** Redo the next transaction on every timeline where it is at the head. */
	redoTransaction?: () => void
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
		const timeline = store.timelines.get(token.key)!
		const undoTransactionGroup = getTimelineTransactionAtHead(timeline, `undo`)
		const redoTransactionGroup = getTimelineTransactionAtHead(timeline, `redo`)
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
			...(undoTransactionGroup
				? {
						undoTransaction: () => {
							timeTravelTransactionGroupInStore(
								store,
								`undo`,
								undoTransactionGroup,
							)
						},
					}
				: {}),
			...(redoTransactionGroup
				? {
						redoTransaction: () => {
							timeTravelTransactionGroupInStore(
								store,
								`redo`,
								redoTransactionGroup,
							)
						},
					}
				: {}),
		}
	}
	return useSyncExternalStore<TimelineMeta>((dispatch) => {
		return subscribeToTimeline(store, token, `use-tl:${id}`, dispatch)
	}, getSnapshot)
}
