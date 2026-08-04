import type { TransactionOutcomeEvent, TransactionToken } from "atom.io"

import type { Store } from "../store/index.ts"
import {
	beginTransactionNotificationBatch,
	cancelTransactionNotificationBatch,
	flushTransactionNotificationBatch,
	throwCollectedNotificationErrors,
} from "../transaction/transaction-notification-batch.ts"
import { ingestAtomUpdateEvent } from "./ingest-atom-update.ts"
import {
	ingestCreationEvent,
	ingestDisposalEvent,
	ingestMoleculeCreationEvent,
	ingestMoleculeDisposalEvent,
	ingestMoleculeTransferEvent,
} from "./ingest-creation-disposal.ts"

export function ingestTransactionOutcomeEvent<T extends TransactionToken<any>>(
	store: Store,
	event: TransactionOutcomeEvent<T>,
	applying: `newValue` | `oldValue`,
): void {
	const ownsNotificationBatch = beginTransactionNotificationBatch(store)
	try {
		ingestTransactionSubEvents(store, event, applying)
	} catch (error) {
		if (ownsNotificationBatch) cancelTransactionNotificationBatch(store)
		throw error
	}
	if (ownsNotificationBatch) {
		const errors = flushTransactionNotificationBatch(store)
		throwCollectedNotificationErrors(errors)
	}
}

function ingestTransactionSubEvents(
	store: Store,
	event: TransactionOutcomeEvent<any>,
	applying: `newValue` | `oldValue`,
): void {
	const subEvents =
		applying === `newValue` ? event.subEvents : [...event.subEvents].reverse()
	for (const subEvent of subEvents) {
		switch (subEvent.type) {
			case `atom_update`:
				ingestAtomUpdateEvent(store, subEvent, applying)
				break
			case `atom_creation`:
				ingestCreationEvent(store, subEvent, applying)
				break
			case `atom_disposal`:
				ingestDisposalEvent(store, subEvent, applying)
				break
			case `molecule_creation`:
				ingestMoleculeCreationEvent(store, subEvent, applying)
				break
			case `molecule_disposal`:
				ingestMoleculeDisposalEvent(store, subEvent, applying)
				break
			case `molecule_transfer`:
				ingestMoleculeTransferEvent(store, subEvent, applying)
				break
			case `transaction_outcome`:
				ingestTransactionOutcomeEvent(store, subEvent, applying)
				break
		}
	}
}
