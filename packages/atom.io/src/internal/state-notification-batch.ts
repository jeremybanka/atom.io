import type { StateUpdate } from "atom.io"
import type { Subject } from "atom.io/foundations/subject"

import type { Store } from "./store/index.ts"

type DeferredStateNotification = {
	subject: Subject<StateUpdate<any>>
	update: StateUpdate<any>
}

type StateNotificationBatch = {
	readonly selectorNotifications: Map<string, () => void>
	readonly stateNotifications: Map<string, DeferredStateNotification>
}

const stateNotificationBatches = new WeakMap<Store, StateNotificationBatch>()

export function startStateNotificationBatch(store: Store): boolean {
	if (stateNotificationBatches.has(store)) return false
	stateNotificationBatches.set(store, {
		selectorNotifications: new Map(),
		stateNotifications: new Map(),
	})
	return true
}

export function hasStateNotificationBatch(store: Store): boolean {
	return stateNotificationBatches.has(store)
}

export function deferStateNotification(
	store: Store,
	stateKey: string,
	subject: Subject<StateUpdate<any>>,
	update: StateUpdate<any>,
): void {
	const batch = stateNotificationBatches.get(store)
	if (!batch) return
	const previous = batch.stateNotifications.get(stateKey)
	if (!previous) {
		batch.stateNotifications.set(stateKey, { subject, update })
		return
	}
	previous.update =
		`oldValue` in previous.update
			? {
					oldValue: previous.update.oldValue,
					newValue: update.newValue,
				}
			: { newValue: update.newValue }
}

export function deferSelectorNotification(
	store: Store,
	selectorKey: string,
	notify: () => void,
): void {
	const batch = stateNotificationBatches.get(store)
	batch?.selectorNotifications.set(selectorKey, notify)
}

export function flushStateNotificationBatch(store: Store): void {
	const batch = stateNotificationBatches.get(store)
	if (!batch) return
	try {
		for (const { subject, update } of batch.stateNotifications.values()) {
			subject.next(update)
		}
		for (const notify of batch.selectorNotifications.values()) {
			notify()
		}
	} finally {
		stateNotificationBatches.delete(store)
	}
}

export function cancelStateNotificationBatch(store: Store): void {
	stateNotificationBatches.delete(store)
}
