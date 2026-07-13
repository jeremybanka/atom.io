import type { StateUpdate } from "atom.io"
import type { Subject } from "atom.io/foundations/subject"

import type { Store } from "./store/index.ts"
import {
	captureObserverError,
	notifySubjectSubscribers,
} from "./transaction/transaction-observer-errors.ts"

type DeferredStateNotification = {
	subject: Subject<StateUpdate<any>>
	update: StateUpdate<any>
}

export type StateNotificationBatch = {
	flushing: boolean
	selectorNotifications: Map<string, () => void>
	stateNotifications: Map<string, DeferredStateNotification>
}

const stateNotificationBatches = new WeakMap<Store, StateNotificationBatch>()

export function startStateNotificationBatch(store: Store): void {
	stateNotificationBatches.set(store, {
		flushing: false,
		selectorNotifications: new Map(),
		stateNotifications: new Map(),
	})
}

export function hasStateNotificationBatch(store: Store): boolean {
	return stateNotificationBatches.has(store)
}

export function isFlushingStateNotificationBatch(store: Store): boolean {
	return stateNotificationBatches.get(store)?.flushing ?? false
}

export function suspendStateNotificationBatch(
	store: Store,
): StateNotificationBatch {
	const batch = stateNotificationBatches.get(store)!
	stateNotificationBatches.delete(store)
	return batch
}

export function resumeStateNotificationBatch(
	store: Store,
	batch: StateNotificationBatch,
): void {
	stateNotificationBatches.set(store, batch)
}

export function deferStateNotification(
	store: Store,
	stateKey: string,
	subject: Subject<StateUpdate<any>>,
	update: StateUpdate<any>,
): void {
	stateNotificationBatches
		.get(store)!
		.stateNotifications.set(stateKey, { subject, update })
}

export function deferSelectorNotification(
	store: Store,
	selectorKey: string,
	notify: () => void,
): void {
	stateNotificationBatches
		.get(store)!
		.selectorNotifications.set(selectorKey, notify)
}

export function flushStateNotificationBatch(
	store: Store,
	shouldNotifyStateSubscriber: (
		key: string,
		subscriber: (update: StateUpdate<any>) => void,
	) => boolean = () => true,
): void {
	const batch = stateNotificationBatches.get(store)!
	batch.flushing = true
	try {
		for (const { subject, update } of batch.stateNotifications.values()) {
			notifySubjectSubscribers(subject, update, shouldNotifyStateSubscriber)
		}

		for (const notify of batch.selectorNotifications.values()) {
			try {
				notify()
			} catch (error) {
				captureObserverError(error)
			}
		}
	} finally {
		batch.flushing = false
		stateNotificationBatches.delete(store)
	}
}

export function cancelStateNotificationBatch(store: Store): void {
	stateNotificationBatches.delete(store)
}
