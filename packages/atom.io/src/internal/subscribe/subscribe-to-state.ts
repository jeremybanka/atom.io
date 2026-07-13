import type { ReadableToken, StateUpdate, UpdateHandler } from "atom.io"

import { hasRole } from "../atom/index.ts"
import { ensureState } from "../get-state/ensure-state.ts"
import { readOrComputeValue } from "../get-state/index.ts"
import { traceRootSelectorAtoms } from "../selector/index.ts"
import type { Store } from "../store/index.ts"
import { withdraw } from "../store/index.ts"
import { registerSelectorRootSubscriptionReconciler } from "./selector-root-subscriptions.ts"
import { subscribeToRootDependency } from "./subscribe-to-root-atoms.ts"

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
	const rootSubs = new Map<string, () => void>()
	let updateHandler: UpdateHandler<E | T> = safelyHandleUpdate
	let unregisterRootSubscriptionReconciler = () => {}
	if (isSelector) {
		readOrComputeValue(store, state)
		for (const [atomKey, atom] of traceRootSelectorAtoms(store, state.key)) {
			rootSubs.set(atomKey, subscribeToRootDependency(store, state, atom))
		}
		const reconcileRootSubscriptions = () => {
			const dependencies = traceRootSelectorAtoms(store, state.key)
			store.selectorAtoms.delete(state.key)
			for (const atomKey of dependencies.keys()) {
				store.selectorAtoms.set({ selectorKey: state.key, atomKey })
			}
			for (const [previousRootKey, unsub] of rootSubs) {
				const currentRoot = dependencies.get(previousRootKey)
				if (currentRoot) {
					dependencies.delete(previousRootKey)
				} else {
					unsub()
					rootSubs.delete(previousRootKey)
				}
			}
			for (const [atomKey, atom] of dependencies) {
				rootSubs.set(atomKey, subscribeToRootDependency(store, state, atom))
			}
		}
		unregisterRootSubscriptionReconciler =
			registerSelectorRootSubscriptionReconciler(
				state,
				reconcileRootSubscriptions,
			)
		updateHandler = function updateRootsBeforeHandlingUpdate(update) {
			reconcileRootSubscriptions()
			safelyHandleUpdate(update)
		}
	}
	const mainUnsubFunction = state.subject.subscribe(key, updateHandler)
	const unsubscribe = () => {
		store.logger.info(
			`🙈`,
			state.type,
			state.key,
			`Removing subscription "${key}"`,
		)
		mainUnsubFunction()
		unregisterRootSubscriptionReconciler()
		for (const unsubFromDependency of rootSubs.values()) {
			unsubFromDependency()
		}
	}

	return unsubscribe
}
