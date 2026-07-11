import type { TransactionCommitStrategy } from "atom.io"

import {
	ingestBatchedTransactionOutcomeEvent,
	ingestTransactionOutcomeEvent,
} from "../events/index.ts"
import { newest } from "../lineage.ts"
import { withdraw } from "../store/index.ts"
import type { Fn } from "../utility-types.ts"
import type { ChildStore } from "./is-root-store.ts"
import { isChildStore, isRootStore } from "./is-root-store.ts"
import { setEpochNumberOfAction } from "./set-epoch-number.ts"

export function applyTransaction<F extends Fn>(
	store: ChildStore,
	output: ReturnType<F>,
	commitStrategy: TransactionCommitStrategy = `playback`,
): void {
	const child = newest(store)
	const { parent } = child

	child.transactionMeta.phase = `applying`
	child.transactionMeta.update.output = output
	parent.child = null
	try {
		parent.on.transactionApplying.next(child.transactionMeta)
		const { subEvents: updates } = child.transactionMeta.update
		store.logger.info(
			`🛄`,
			`transaction`,
			child.transactionMeta.update.token.key,
			`applying ${updates.length} subEvents:`,
			updates,
		)

		const committedAsBatch =
			commitStrategy === `batched` &&
			ingestBatchedTransactionOutcomeEvent(parent, child.transactionMeta.update)
		if (!committedAsBatch) {
			ingestTransactionOutcomeEvent(
				parent,
				child.transactionMeta.update,
				`newValue`,
			)
		}

		if (isRootStore(parent)) {
			setEpochNumberOfAction(
				parent,
				child.transactionMeta.update.token.key,
				child.transactionMeta.update.epoch,
			)
			const myTransaction = withdraw<Fn>(store, {
				key: child.transactionMeta.update.token.key,
				type: `transaction`,
			})
			myTransaction?.subject.next(child.transactionMeta.update)
			store.logger.info(
				`🛬`,
				`transaction`,
				child.transactionMeta.update.token.key,
				`applied`,
			)
		} else if (isChildStore(parent)) {
			parent.transactionMeta.update.subEvents.push(child.transactionMeta.update)
		}
	} finally {
		parent.on.transactionApplying.next(null)
	}
}
