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
const transactionNotificationErrors = new WeakMap<Store, unknown[]>()

export function beginTransactionNotificationBatch(store: Store): boolean {
	if (transactionNotificationBatches.has(store)) return false
	transactionNotificationBatches.set(store, {
		phase: `collecting`,
		previousValues: new Map(),
		selectorNotifications: new Map(),
		stateNotifications: new Map(),
	})
	transactionNotificationErrors.set(store, [])
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

export function notifyTransactionSubject<T>(
	store: Store,
	subject: Subject<T>,
	value: T,
): void {
	const errors = transactionNotificationErrors.get(store)
	if (!errors) {
		subject.next(value)
		return
	}
	notifySubjectAndCollectErrors(subject, value, errors)
}

export function notifySubjectAndCollectErrors<T>(
	subject: Subject<T>,
	value: T,
	errors: unknown[],
): void {
	for (const subscriber of subject.subscribers.values()) {
		try {
			subscriber(value)
		} catch (error) {
			errors.push(error)
		}
	}
}

export function throwCollectedNotificationErrors(errors: unknown[]): void {
	if (errors.length === 1) throw errors[0]
	if (errors.length > 1) {
		throw new AggregateError(
			errors,
			`Transaction committed, but multiple observers threw.`,
		)
	}
}

export function flushTransactionNotificationBatch(store: Store): unknown[] {
	const batch = transactionNotificationBatches.get(store)
	const errors = transactionNotificationErrors.get(store) ?? []
	if (!batch) return errors

	try {
		batch.phase = `state`
		for (const { subject, update } of batch.stateNotifications.values()) {
			notifyTransactionSubject(store, subject, update)
		}

		batch.phase = `selector`
		for (const notify of batch.selectorNotifications.values()) {
			try {
				notify()
			} catch (error) {
				errors.push(error)
			}
		}
	} finally {
		transactionNotificationBatches.delete(store)
		transactionNotificationErrors.delete(store)
	}
	return errors
}

export function cancelTransactionNotificationBatch(store: Store): void {
	transactionNotificationBatches.delete(store)
	transactionNotificationErrors.delete(store)
}
