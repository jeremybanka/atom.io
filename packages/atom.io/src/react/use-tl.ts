import type { TimelineFamilyToken, TimelineToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import {
	clearTimelineInStore,
	findTimelineInStore,
	getTimelineTransactionAtHead,
	inspectTimelineInStore,
	subscribeToTimeline,
	timeTravel,
	timeTravelTransactionGroupInStore,
} from "atom.io/internal"
import { useContext, useId, useRef, useSyncExternalStore } from "react"

import { StoreContext } from "./store-context.tsx"

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
	const getTransactionGroups = () => {
		const timeline = store.timelines.get(token.key)!
		return {
			undo: getTimelineTransactionAtHead(timeline, `undo`),
			redo: getTimelineTransactionAtHead(timeline, `redo`),
		}
	}
	const initialTransactionGroups = getTransactionGroups()
	const undoTransactionGroupRef = useRef(initialTransactionGroups.undo)
	const redoTransactionGroupRef = useRef(initialTransactionGroups.redo)
	const rebuildMeta = (
		transactionGroups: ReturnType<typeof getTransactionGroups>,
	) => {
		const { at, length } = inspectTimelineInStore(store, token)
		const undoTransactionGroup = transactionGroups.undo
		const redoTransactionGroup = transactionGroups.redo
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
	const meta = useRef<TimelineMeta>(rebuildMeta(initialTransactionGroups))
	const retrieve = () => {
		const { at, length } = inspectTimelineInStore(store, token)
		const transactionGroups = getTransactionGroups()
		if (
			meta.current.at !== at ||
			meta.current.length !== length ||
			storeRef.current !== store ||
			tokenRef.current.key !== token.key ||
			undoTransactionGroupRef.current !== transactionGroups.undo ||
			redoTransactionGroupRef.current !== transactionGroups.redo
		) {
			storeRef.current = store
			tokenRef.current = token
			undoTransactionGroupRef.current = transactionGroups.undo
			redoTransactionGroupRef.current = transactionGroups.redo
			meta.current = rebuildMeta(transactionGroups)
		}
		return meta.current
	}
	return useSyncExternalStore<TimelineMeta>(
		(dispatch) => subscribeToTimeline(store, token, `use-tl:${id}`, dispatch),
		retrieve,
		retrieve,
	)
}
