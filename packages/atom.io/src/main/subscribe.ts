import type { Canonical } from "atom.io/foundations/canonical"
import type { Fn } from "atom.io/internal"
import { arbitrary, IMPLICIT, subscribeInStore } from "atom.io/internal"

import type {
	StateUpdate,
	TimelineUpdate,
	TransactionOutcomeEvent,
} from "./events.ts"
import type { TimelineManageable } from "./timeline.ts"
import type {
	ReadableToken,
	TimelineFamilyToken,
	TimelineToken,
	TransactionToken,
} from "./tokens.ts"

export type UpdateHandler<T> = (update: StateUpdate<T>) => void
export type TransactionUpdateHandler<F extends Fn> = (
	data: TransactionOutcomeEvent<TransactionToken<F>>,
) => void

/**
 * Subscribe to a state in the implicit store
 * @param token - The token of the state to subscribe to
 * @param handleUpdate - A function that will be called when the state is updated
 * @param key - A unique key for the subscription. If not provided, a random key will be generated.
 * @returns A function that can be called to unsubscribe from the state
 * @overload State
 */
export function subscribe<T>(
	token: ReadableToken<T>,
	handleUpdate: UpdateHandler<T>,
	key?: string,
): () => void
/**
 * Subscribe to a transaction in the implicit store
 * @param token - The token of the transaction to subscribe to
 * @param handleUpdate - A function that will be called when the transaction succeeds
 * @param key - A unique key for the subscription. If not provided, a random key will be generated.
 * @returns A function that can be called to unsubscribe from the transaction
 * @overload Transaction
 */
export function subscribe<F extends Fn>(
	token: TransactionToken<F>,
	handleUpdate: TransactionUpdateHandler<F>,
	key?: string,
): () => void
/**
 * Subscribe to a timeline in the implicit store
 * @param token - The token of the timeline to subscribe to
 * @param handleUpdate - A function that will be called when a new update is available
 * @param key - A unique key for the subscription. If not provided, a random key will be generated.
 * @returns A function that can be called to unsubscribe from the timeline
 * @overload Timeline
 */
export function subscribe<M extends TimelineManageable>(
	token: TimelineToken<M>,
	handleUpdate: (update: TimelineUpdate<M>) => void,
	key?: string,
): () => void
export function subscribe<K extends Canonical, M extends TimelineManageable>(
	family: TimelineFamilyToken<K, M>,
	memberKey: NoInfer<K>,
	handleUpdate: (update: TimelineUpdate<M>) => void,
	subscriptionKey?: string,
): () => void
export function subscribe(...params: any[]): () => void {
	if (params[0].type === `timeline_family`) {
		return subscribeInStore(
			IMPLICIT.STORE,
			params[0],
			params[1] as Canonical,
			params[2] as (update: TimelineUpdate<any>) => void,
			params[3] ?? arbitrary(),
		)
	}
	return subscribeInStore(
		IMPLICIT.STORE,
		params[0] as ReadableToken<any> | TimelineToken<any> | TransactionToken<any>,
		params[1] as (update: any) => void,
		(params[2] as string | undefined) ?? arbitrary(),
	)
}
