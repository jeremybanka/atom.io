import type {
	AtomToken,
	AtomUpdateEvent,
	TransactionOutcomeEvent,
} from "atom.io"
import { Future } from "atom.io/foundations/future"

import { hasRole } from "../atom/index.ts"
import {
	closeOperation,
	type OpenOperation,
	openOperation,
} from "../operation.ts"
import { JOIN_OP, operateOnStore } from "../set-state/operate-on-store.ts"
import {
	cancelStateNotificationBatch,
	startStateNotificationBatch,
} from "../state-notification-batch.ts"
import type { Store } from "../store/index.ts"
import { withdraw } from "../store/index.ts"

type AnyAtomUpdate = AtomUpdateEvent<AtomToken<any, any, any>>

export type BatchedTransactionPlan = {
	readonly finalUpdates: ReadonlyMap<string, AnyAtomUpdate>
}

export type BatchedTransactionPreparation =
	| { readonly plan: BatchedTransactionPlan; readonly supported: true }
	| { readonly reason: string; readonly supported: false }

type ValueSnapshot = {
	readonly hadValue: boolean
	readonly value: unknown
}

function collectAtomUpdates(
	event: TransactionOutcomeEvent<any>,
	updates: AnyAtomUpdate[],
): string | null {
	for (const subEvent of event.subEvents) {
		switch (subEvent.type) {
			case `atom_update`:
				updates.push(subEvent)
				break
			case `transaction_outcome`: {
				const rejection = collectAtomUpdates(subEvent, updates)
				if (rejection) return rejection
				break
			}
			case `atom_creation`:
			case `atom_disposal`:
			case `molecule_creation`:
			case `molecule_disposal`:
			case `molecule_transfer`:
				return `contains a ${subEvent.type} event`
		}
	}
	return null
}

function cannotBatchAtomUpdate(
	store: Store,
	update: AnyAtomUpdate,
): string | null {
	const atom = withdraw(store, update.token)
	if (atom.type !== `atom`) {
		return `updates non-regular atom "${atom.key}"`
	}
	if (hasRole(atom, `tracker:signal`)) {
		return `updates mutable tracker signal "${atom.key}"`
	}
	if (update.update.newValue instanceof Promise) {
		return `updates asynchronous atom "${atom.key}"`
	}
	if (store.valueMap.get(atom.key) instanceof Future) {
		return `updates pending atom "${atom.key}"`
	}

	const downstreamKeys = store.selectorAtoms.getRelatedKeys(atom.key)
	if (!downstreamKeys) return null
	for (const selectorKey of downstreamKeys) {
		if (store.valueMap.get(selectorKey) instanceof Future) {
			return `affects pending selector "${selectorKey}"`
		}
	}
	return null
}

export function prepareBatchedTransactionOutcomeEvent(
	store: Store,
	event: TransactionOutcomeEvent<any>,
): BatchedTransactionPreparation {
	const updates: AnyAtomUpdate[] = []
	const collectionRejection = collectAtomUpdates(event, updates)
	if (collectionRejection) {
		return { reason: collectionRejection, supported: false }
	}

	const finalUpdates = new Map<string, AnyAtomUpdate>()
	for (const update of updates) finalUpdates.set(update.token.key, update)
	for (const update of updates) {
		const rejection = cannotBatchAtomUpdate(store, update)
		if (rejection) return { reason: rejection, supported: false }
	}

	return {
		plan: { finalUpdates },
		supported: true,
	}
}

function takeValueSnapshots(
	store: Store,
	plan: BatchedTransactionPlan,
): Map<string, ValueSnapshot> {
	const keys = new Set<string>()
	for (const update of plan.finalUpdates.values()) {
		keys.add(update.token.key)
		const downstreamKeys = store.selectorAtoms.getRelatedKeys(update.token.key)
		if (downstreamKeys) {
			for (const selectorKey of downstreamKeys) keys.add(selectorKey)
		}
	}

	const snapshots = new Map<string, ValueSnapshot>()
	for (const key of keys) {
		snapshots.set(key, {
			hadValue: store.valueMap.has(key),
			value: store.valueMap.get(key),
		})
	}
	return snapshots
}

function restoreValueSnapshots(
	store: Store,
	snapshots: ReadonlyMap<string, ValueSnapshot>,
): void {
	for (const [key, snapshot] of snapshots) {
		if (snapshot.hadValue) store.valueMap.set(key, snapshot.value)
		else store.valueMap.delete(key)
	}
}

/**
 * Install final atom values while retaining the operation and notification batch.
 * The caller finalizes epoch/outcome publication, flushes, and closes the operation.
 */
export function installBatchedTransactionPlan(
	store: Store,
	plan: BatchedTransactionPlan,
): (Store & { operation: OpenOperation }) | null {
	if (plan.finalUpdates.size === 0) return null

	const snapshots = takeValueSnapshots(store, plan)
	const firstUpdate = plan.finalUpdates.values().next().value!
	const target = openOperation(store, firstUpdate.token) as Store & {
		operation: OpenOperation
	}
	startStateNotificationBatch(store)
	try {
		for (const update of plan.finalUpdates.values()) {
			operateOnStore(JOIN_OP, target, update.token, update.update.newValue)
		}
		return target
	} catch (error) {
		restoreValueSnapshots(store, snapshots)
		cancelStateNotificationBatch(store)
		closeOperation(target)
		throw error
	}
}
