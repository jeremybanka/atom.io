import type {
	AtomToken,
	AtomUpdateEvent,
	TransactionOutcomeEvent,
} from "atom.io"
import { Future } from "atom.io/foundations/future"

import { hasRole } from "../atom/index.ts"
import { closeOperation, openOperation } from "../operation.ts"
import { JOIN_OP, operateOnStore } from "../set-state/operate-on-store.ts"
import {
	cancelStateNotificationBatch,
	flushStateNotificationBatch,
	startStateNotificationBatch,
} from "../state-notification-batch.ts"
import type { Store } from "../store/index.ts"
import { withdraw } from "../store/index.ts"

type AnyAtomUpdate = AtomUpdateEvent<AtomToken<any, any, any>>

function collectAtomUpdates(
	event: TransactionOutcomeEvent<any>,
	updates: AnyAtomUpdate[],
): boolean {
	for (const subEvent of event.subEvents) {
		switch (subEvent.type) {
			case `atom_update`:
				updates.push(subEvent)
				break
			case `transaction_outcome`:
				if (!collectAtomUpdates(subEvent, updates)) return false
				break
			case `atom_creation`:
			case `atom_disposal`:
			case `molecule_creation`:
			case `molecule_disposal`:
			case `molecule_transfer`:
				return false
		}
	}
	return true
}

function canBatchAtomUpdate(store: Store, update: AnyAtomUpdate): boolean {
	const atom = withdraw(store, update.token)
	if (
		atom.type !== `atom` ||
		hasRole(atom, `tracker:signal`) ||
		update.update.newValue instanceof Promise ||
		store.valueMap.get(atom.key) instanceof Future
	) {
		return false
	}

	const downstreamKeys = store.selectorAtoms.getRelatedKeys(atom.key)
	if (!downstreamKeys) return true
	for (const selectorKey of downstreamKeys) {
		if (store.valueMap.get(selectorKey) instanceof Future) return false
	}
	return true
}

export function ingestBatchedTransactionOutcomeEvent(
	store: Store,
	event: TransactionOutcomeEvent<any>,
): boolean {
	if (store.parent !== null || store.operation.open) return false

	const updates: AnyAtomUpdate[] = []
	if (!collectAtomUpdates(event, updates)) return false
	if (updates.length === 0) return true
	for (const update of updates) {
		if (update.update.newValue instanceof Promise) return false
	}
	const finalUpdates = new Map<string, AnyAtomUpdate>()
	for (const update of updates) finalUpdates.set(update.token.key, update)
	for (const update of finalUpdates.values()) {
		if (!canBatchAtomUpdate(store, update)) return false
	}
	if (!startStateNotificationBatch(store)) return false

	const target = openOperation(store, updates[0].token)
	if (typeof target === `number`) {
		cancelStateNotificationBatch(store)
		return false
	}

	try {
		for (const update of finalUpdates.values()) {
			operateOnStore(JOIN_OP, target, update.token, update.update.newValue)
		}
		flushStateNotificationBatch(store)
		return true
	} catch (error) {
		cancelStateNotificationBatch(store)
		throw error
	} finally {
		closeOperation(target)
	}
}
