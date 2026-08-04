import type { StateUpdate } from "atom.io"
import type { Subject } from "atom.io/foundations/subject"

import type { Store } from "../store/index.ts"

type DeferredStateNotification = {
	readonly subject: Subject<StateUpdate<any>>
	update: StateUpdate<any>
}

type TransactionNotificationBatch = {
	phase: `collecting` | `state` | `selector`
	readonly previousValues: Map<string, unknown>
	readonly selectorNotifications: Map<string, () => void>
	readonly stateNotifications: Map<string, DeferredStateNotification>
}

const transactionNotificationBatches = new WeakMap<
	Store,
	TransactionNotificationBatch
>()

export function beginTransactionNotificationBatch(store: Store): boolean {
	if (transactionNotificationBatches.has(store)) return false
	transactionNotificationBatches.set(store, {
		phase: `collecting`,
		previousValues: new Map(),
		selectorNotifications: new Map(),
		stateNotifications: new Map(),
	})
	return true
}

export function deferTransactionStateNotification(
	store: Store,
	stateKey: string,
	subject: Subject<StateUpdate<any>>,
	update: StateUpdate<any>,
): boolean {
	const batch = transactionNotificationBatches.get(store)
	if (batch?.phase !== `collecting`) return false

	const previous = batch.stateNotifications.get(stateKey)
	if (previous && `oldValue` in previous.update) {
		previous.update = {
			oldValue: previous.update.oldValue,
			newValue: update.newValue,
		}
	} else if (previous) {
		previous.update = { newValue: update.newValue }
	} else {
		batch.stateNotifications.set(stateKey, { subject, update })
	}
	return true
}

export function deferTransactionSelectorNotification(
	store: Store,
	selectorKey: string,
	notify: () => void,
): boolean {
	const batch = transactionNotificationBatches.get(store)
	if (batch?.phase !== `state`) return false
	batch.selectorNotifications.set(selectorKey, notify)
	return true
}

export function retainTransactionPreviousValue(
	store: Store,
	stateKey: string,
	value: unknown,
): void {
	const batch = transactionNotificationBatches.get(store)
	if (batch?.phase !== `collecting` || batch.previousValues.has(stateKey)) {
		return
	}
	batch.previousValues.set(stateKey, value)
}

export function recallTransactionPreviousValue(
	store: Store,
	stateKey: string,
): { found: boolean; value: unknown } {
	const previousValues =
		transactionNotificationBatches.get(store)?.previousValues
	return previousValues?.has(stateKey)
		? { found: true, value: previousValues.get(stateKey) }
		: { found: false, value: undefined }
}

export function flushTransactionNotificationBatch(store: Store): void {
	const batch = transactionNotificationBatches.get(store)
	if (!batch) return

	try {
		batch.phase = `state`
		for (const { subject, update } of batch.stateNotifications.values()) {
			subject.next(update)
		}

		batch.phase = `selector`
		for (const notify of batch.selectorNotifications.values()) notify()
	} finally {
		transactionNotificationBatches.delete(store)
	}
}

export function cancelTransactionNotificationBatch(store: Store): void {
	transactionNotificationBatches.delete(store)
}
