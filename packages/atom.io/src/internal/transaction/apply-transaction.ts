import { ingestTransactionOutcomeEvent } from "../events/index.ts"
import { newest } from "../lineage.ts"
import { withdraw } from "../store/index.ts"
import type { Fn } from "../utility-types.ts"
import type { ChildStore } from "./is-root-store.ts"
import { isChildStore, isRootStore } from "./is-root-store.ts"
import {
	captureTransactionCommitSnapshots,
	createTransactionCommitEvent,
	markTransactionCommitted,
} from "./transaction-commit-status.ts"
import {
	beginTransactionNotificationBatch,
	cancelTransactionNotificationBatch,
	flushTransactionNotificationBatch,
	notifySubjectAndCollectErrors,
	throwCollectedNotificationErrors,
} from "./transaction-notification-batch.ts"

export function applyTransaction<F extends Fn>(
	store: ChildStore,
	output: ReturnType<F>,
): void {
	const child = newest(store)
	const { parent } = child

	child.transactionMeta.phase = `applying`
	child.transactionMeta.update.output = output
	parent.child = null
	parent.on.transactionApplying.next(child.transactionMeta)
	const { subEvents: updates } = child.transactionMeta.update
	store.logger.info(
		`🛄`,
		`transaction`,
		child.transactionMeta.update.token.key,
		`applying ${updates.length} subEvents:`,
		updates,
	)

	const rootCommit = isRootStore(parent)
	const ownsNotificationBatch =
		rootCommit && beginTransactionNotificationBatch(parent)
	const notificationErrors: unknown[] = []
	const commitSnapshots = rootCommit
		? captureTransactionCommitSnapshots(
				parent,
				child,
				child.transactionMeta.update,
			)
		: []
	try {
		ingestTransactionOutcomeEvent(
			parent,
			child.transactionMeta.update,
			`newValue`,
		)

		if (rootCommit) {
			const commitEvent = createTransactionCommitEvent(
				parent,
				child.transactionMeta.update,
				markTransactionCommitted(parent),
				commitSnapshots,
			)
			notifySubjectAndCollectErrors(
				parent.on.transactionCommit,
				commitEvent,
				notificationErrors,
			)
			if (ownsNotificationBatch) {
				notificationErrors.push(...flushTransactionNotificationBatch(parent))
			}
			const myTransaction = withdraw<Fn>(store, {
				key: child.transactionMeta.update.token.key,
				type: `transaction`,
			})
			if (myTransaction) {
				notifySubjectAndCollectErrors(
					myTransaction.subject,
					child.transactionMeta.update,
					notificationErrors,
				)
			}
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
		if (ownsNotificationBatch) cancelTransactionNotificationBatch(parent)
		parent.on.transactionApplying.next(null)
	}
	throwCollectedNotificationErrors(notificationErrors)
}
