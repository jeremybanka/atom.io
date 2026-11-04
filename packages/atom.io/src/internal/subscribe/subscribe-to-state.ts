import type { ReadableToken, StateUpdate, UpdateHandler } from "atom.io"

import { hasRole } from "../atom/index.ts"
import { ensureState } from "../get-state/ensure-state.ts"
import { readOrComputeValue } from "../get-state/index.ts"
import { updateRootSubscriptions } from "../selector/update-root-subscriptions.ts"
import type { ReadableState } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import { withdraw } from "../store/index.ts"

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
		state.type === `readonly_pure_selector` ||
		state.type === `writable_held_selector` ||
		state.type === `readonly_held_selector`
	if (isSelector) {
		readOrComputeValue(store, state)
		state.rootSubscriptions ??= new Map()
		updateRootSubscriptions(store, state)
	}
	const mainUnsubFunction = subscribeToStateSubject(
		state,
		key,
		safelyHandleUpdate,
	)
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

/** Observe state notifications without computing the state or installing roots. */
export function subscribeToStateSubject<T, E>(
	state: ReadableState<T, E>,
	key: string,
	handleUpdate: UpdateHandler<E | T>,
): () => void {
	const subscriber: UpdateHandler<E | T> = (update) => {
		handleUpdate(update)
	}
	const unsubscribe = state.subject.subscribe(key, subscriber)
	return () => {
		if (state.subject.subscribers.get(key) !== subscriber) return
		unsubscribe()
		if (
			state.type !== `atom` &&
			state.type !== `mutable_atom` &&
			state.subject.subscribers.size === 0
		) {
			const roots = state.rootSubscriptions
			state.rootSubscriptions = undefined
			if (roots) for (const stop of roots.values()) stop()
		}
	}
}
