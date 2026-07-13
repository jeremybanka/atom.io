import type {
	TransactionOutcomeEvent,
	TransactionToken,
	TransactionUpdateHandler,
} from "atom.io"

import type { Store } from "../store/index.ts"
import { withdraw } from "../store/index.ts"
import type { Fn } from "../utility-types.ts"

type AnyTransactionSubscriber = (
	data: TransactionOutcomeEvent<TransactionToken<any>>,
) => void

const realtimeTransactionSubscribers = new WeakSet<AnyTransactionSubscriber>()

export function isRealtimeTransactionSubscriber(
	subscriber: AnyTransactionSubscriber,
): boolean {
	return realtimeTransactionSubscribers.has(subscriber)
}

export function subscribeToTransaction<F extends Fn>(
	store: Store,
	token: TransactionToken<F>,
	key: string,
	handleUpdate: TransactionUpdateHandler<F>,
	role?: `realtime`,
): () => void {
	const tx = withdraw(store, token)
	store.logger.info(
		`👀`,
		`transaction`,
		token.key,
		`Adding subscription "${key}"`,
	)
	if (role === `realtime`) {
		realtimeTransactionSubscribers.add(handleUpdate as AnyTransactionSubscriber)
	}
	const unsubscribe = tx.subject.subscribe(key, handleUpdate)
	return () => {
		store.logger.info(
			`🙈`,
			`transaction`,
			token.key,
			`Removing subscription "${key}"`,
		)
		unsubscribe()
	}
}
