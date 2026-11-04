import type { ReadableToken, StateUpdate, UpdateHandler } from "atom.io"

import { hasRole } from "../atom/index.ts"
import { ensureState } from "../get-state/ensure-state.ts"
import { readOrComputeValue } from "../get-state/index.ts"
import { traceRootSelectorAtoms } from "../selector/index.ts"
import type { Store } from "../store/index.ts"
import { withdraw } from "../store/index.ts"
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
		state.type === `readonly_pure_selector` ||
		state.type === `writable_held_selector` ||
		state.type === `readonly_held_selector`
	if (isSelector) {
		readOrComputeValue(store, state)
		if (!state.subject.rootSubscriptions) {
			const roots = new Map<string, () => void>()
			state.subject.rootSubscriptions = roots
			state.subject.updateRootSubscriptions = () => {
				const dependencies = traceRootSelectorAtoms(store, state.key)
				for (const [atomKey, unsubscribe] of roots) {
					if (dependencies.has(atomKey)) dependencies.delete(atomKey)
					else {
						unsubscribe()
						roots.delete(atomKey)
					}
				}
				for (const [atomKey, atom] of dependencies)
					roots.set(atomKey, subscribeToRootDependency(store, state, atom))
			}
		}
		state.subject.updateRootSubscriptions!()
	}
	const mainUnsubFunction = state.subject.subscribe(key, safelyHandleUpdate)
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
