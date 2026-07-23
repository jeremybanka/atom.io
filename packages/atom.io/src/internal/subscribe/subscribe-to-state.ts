import type { ReadableToken, StateUpdate, UpdateHandler } from "atom.io"

import { hasRole } from "../atom/index.ts"
import { ensureState } from "../get-state/ensure-state.ts"
import type { Store } from "../store/index.ts"
import { withdraw } from "../store/index.ts"
import { subscribeToSelectorState } from "./selector-root-subscriptions.ts"

export function subscribeToState<T, E>(
	store: Store,
	token: ReadableToken<T, any, E>,
	key: string,
	handleUpdate: UpdateHandler<E | T>,
): () => void {
	function safelyHandleUpdate(update: StateUpdate<any>): void {
		if (
			store.operation.open &&
			state?.type === `atom` &&
			hasRole(state, `tracker:signal`) &&
			`*` + store.operation.token.key === token.key &&
			`inboundTracker` in handleUpdate
		) {
			return
		}
		handleUpdate(update)
	}
	ensureState(store, token)
	const state = withdraw(store, token)
	store.logger.info(`👀`, state.type, state.key, `Adding subscription "${key}"`)
	const isSelector =
		state.type === `writable_pure_selector` ||
		state.type === `readonly_pure_selector`
	const mainUnsubFunction = isSelector
		? subscribeToSelectorState(store, state, key, safelyHandleUpdate)
		: state.subject.subscribe(key, safelyHandleUpdate)
	const unsubscribe = () => {
		store.logger.info(
			`🙈`,
			state.type,
			state.key,
			`Removing subscription "${key}"`,
		)
		mainUnsubFunction()
	}

	return unsubscribe
}
