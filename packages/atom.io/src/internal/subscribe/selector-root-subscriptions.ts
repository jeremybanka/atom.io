import type { StateUpdate, UpdateHandler } from "atom.io"

import { readOrComputeValue } from "../get-state/read-or-compute-value.ts"
import { getSelectorRootAtoms } from "../selector/get-selector-root-atoms.ts"
import type { PureSelector } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import { subscribeToRootDependency } from "./subscribe-to-root-atoms.ts"

type RootSubscriptionManager = {
	readonly rootUnsubscribers: Map<string, () => void>
	readonly selector: PureSelector<any, any>
	readonly store: Store
	readonly subscribers: Map<string, UpdateHandler<any>>
	unsubscribeFromSelector: () => void
}

const rootSubscriptionManagers = new WeakMap<
	PureSelector<any, any>,
	RootSubscriptionManager
>()

function reconcileRootSubscriptions(manager: RootSubscriptionManager): void {
	const { rootUnsubscribers, selector, store } = manager
	const dependencies = getSelectorRootAtoms(store, selector.key)
	for (const [previousRootKey, unsubscribe] of rootUnsubscribers) {
		if (dependencies.has(previousRootKey)) {
			dependencies.delete(previousRootKey)
		} else {
			unsubscribe()
			rootUnsubscribers.delete(previousRootKey)
		}
	}
	for (const [atomKey, atom] of dependencies) {
		rootUnsubscribers.set(
			atomKey,
			subscribeToRootDependency(store, selector, atom),
		)
	}
}

export function subscribeToSelectorState(
	store: Store,
	selector: PureSelector<any, any>,
	key: string,
	handleUpdate: UpdateHandler<any>,
): () => void {
	let manager = rootSubscriptionManagers.get(selector)
	if (!manager) {
		const newManager: RootSubscriptionManager = {
			rootUnsubscribers: new Map(),
			selector,
			store,
			subscribers: new Map(),
			unsubscribeFromSelector: () => {},
		}
		manager = newManager
		rootSubscriptionManagers.set(selector, newManager)
		try {
			readOrComputeValue(store, selector)
			reconcileRootSubscriptions(newManager)
			newManager.unsubscribeFromSelector = selector.subject.subscribe(
				`${selector.type}:${selector.key}:root-manager`,
				(update: StateUpdate<any>) => {
					reconcileRootSubscriptions(newManager)
					for (const subscriber of newManager.subscribers.values()) {
						subscriber(update)
					}
				},
			)
		} catch (error) {
			newManager.unsubscribeFromSelector()
			for (const unsubscribe of newManager.rootUnsubscribers.values()) {
				unsubscribe()
			}
			rootSubscriptionManagers.delete(selector)
			throw error
		}
	}
	manager.subscribers.set(key, handleUpdate)

	let released = false
	return () => {
		if (released) return
		released = true
		manager.subscribers.delete(key)
		if (manager.subscribers.size !== 0) return

		manager.unsubscribeFromSelector()
		for (const unsubscribe of manager.rootUnsubscribers.values()) {
			unsubscribe()
		}
		manager.rootUnsubscribers.clear()
		if (rootSubscriptionManagers.get(selector) === manager) {
			rootSubscriptionManagers.delete(selector)
		}
	}
}
