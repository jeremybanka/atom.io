import type {
	ReadableToken,
	TimelineEvent,
	TimelineFamilyToken,
	TimelineManageable,
	TimelineToken,
	TimelineUpdate,
	TransactionToken,
	TransactionUpdateHandler,
	UpdateHandler,
} from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"

import { arbitrary } from "../arbitrary.ts"
import type { Store } from "../store/index.ts"
import { findTimelineInStore } from "../timeline/index.ts"
import type { RootStore } from "../transaction/index.ts"
import type { Fn } from "../utility-types.ts"
import { subscribeToState } from "./subscribe-to-state.ts"
import { subscribeToTimeline } from "./subscribe-to-timeline.ts"
import { subscribeToTransaction } from "./subscribe-to-transaction.ts"

export function subscribeInStore<T>(
	store: Store,
	token: ReadableToken<T>,
	handleUpdate: UpdateHandler<T>,
	key?: string,
): () => void
export function subscribeInStore<F extends Fn>(
	store: Store,
	token: TransactionToken<F>,
	handleUpdate: TransactionUpdateHandler<F>,
	key?: string,
): () => void
export function subscribeInStore<M extends TimelineManageable>(
	store: Store,
	token: TimelineToken<M>,
	handleUpdate: (update: TimelineEvent<M> | `clear` | `redo` | `undo`) => void,
	key?: string,
): () => void
export function subscribeInStore<
	K extends Canonical,
	M extends TimelineManageable,
>(
	store: RootStore,
	family: TimelineFamilyToken<K, M>,
	memberKey: NoInfer<K>,
	handleUpdate: (update: TimelineUpdate<M>) => void,
	key?: string,
): () => void
export function subscribeInStore<M extends TimelineManageable>(
	store: Store,
	...params:
		| [
				token: ReadableToken<any> | TimelineToken<M> | TransactionToken<any>,
				handleUpdate:
					| TransactionUpdateHandler<any>
					| UpdateHandler<any>
					| ((update: TimelineUpdate<M>) => void),
				key?: string,
		  ]
		| [
				family: TimelineFamilyToken<Canonical, M>,
				memberKey: Canonical,
				handleUpdate: (update: TimelineUpdate<M>) => void,
				key?: string,
		  ]
): () => void
export function subscribeInStore(store: Store, ...params: any[]): () => void {
	let token: ReadableToken<any> | TimelineToken<any> | TransactionToken<any>
	let handleUpdate: (update: any) => void
	let key: string
	if (params[0].type === `timeline_family`) {
		token = findTimelineInStore(
			store as RootStore,
			params[0],
			params[1] as Canonical,
		)
		handleUpdate = params[2] as (update: any) => void
		key = params[3] ?? arbitrary()
	} else {
		token = params[0]
		handleUpdate = params[1] as (update: any) => void
		key = (params[2] as string | undefined) ?? arbitrary()
	}
	switch (token.type) {
		case `atom`:
		case `mutable_atom`:
		case `readonly_pure_selector`:
		case `readonly_held_selector`:
		case `writable_pure_selector`:
		case `writable_held_selector`:
			return subscribeToState(store, token, key, handleUpdate)
		case `transaction`:
			return subscribeToTransaction(store, token, key, handleUpdate)
		case `timeline`:
			return subscribeToTimeline(store, token, key, handleUpdate)
	}
}
