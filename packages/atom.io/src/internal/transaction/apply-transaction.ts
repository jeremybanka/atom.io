import type {
	Logger,
	TransactionCommitStrategy,
	TransactionOutcomeEvent,
	TransactionToken,
} from "atom.io"

import {
	ingestTransactionOutcomeEvent,
	installBatchedTransactionPlan,
	prepareBatchedTransactionOutcomeEvent,
} from "../events/index.ts"
import { newest } from "../lineage.ts"
import {
	closeOperation,
	type OpenOperation,
	openOperation,
} from "../operation.ts"
import { drainOperationQueue, enqueueOperation } from "../operation-queue.ts"
import {
	cancelStateNotificationBatch,
	flushStateNotificationBatch,
	hasStateNotificationBatch,
	resumeStateNotificationBatch,
	type StateNotificationBatch,
	suspendStateNotificationBatch,
} from "../state-notification-batch.ts"
import { withdraw } from "../store/index.ts"
import { isRealtimeTransactionSubscriber } from "../subscribe/subscribe-to-transaction.ts"
import {
	isTimelineAtomSubscriber,
	isTimelineTransactionSubscriber,
	prepareTimelinesForTransaction,
} from "../timeline/index.ts"
import type { Fn } from "../utility-types.ts"
import { getEpochNumberOfAction } from "./get-epoch-number.ts"
import type { ChildStore, RootStore } from "./is-root-store.ts"
import { isChildStore } from "./is-root-store.ts"
import { setEpochNumberOfAction } from "./set-epoch-number.ts"
import {
	allowTransactionCommitStateOperations,
	beginTransactionCommit,
	endTransactionCommit,
	flushTransactionCommitObserverNotifications,
	isTransactionCommitActive,
	setQueuedTransactionBase,
} from "./transaction-commit-context.ts"
import {
	captureObserverError,
	collectObserverErrors,
	notifySubjectSubscribers,
} from "./transaction-observer-errors.ts"

type AnyTransactionSubscriber = (
	update: TransactionOutcomeEvent<TransactionToken<any>>,
) => void

function isInternalTransactionSubscriber(
	_key: string,
	subscriber: AnyTransactionSubscriber,
): boolean {
	return (
		isTimelineTransactionSubscriber(subscriber) ||
		isRealtimeTransactionSubscriber(subscriber)
	)
}

function observerError(
	transactionKey: string,
	errors: readonly unknown[],
): AggregateError {
	const details = errors
		.map((error) => (error instanceof Error ? error.message : String(error)))
		.join(`; `)
	return new AggregateError(
		errors,
		`Transaction "${transactionKey}" committed, but one or more observers failed${
			details ? `: ${details}` : `.`
		}`,
	)
}

function observerSafeLogger(logger: Logger): Logger {
	const call = (
		level: keyof Logger,
		params: Parameters<Logger[keyof Logger]>,
	) => {
		try {
			logger[level](...params)
		} catch (error) {
			captureObserverError(error)
		}
	}
	return {
		error: (...params) => {
			call(`error`, params)
		},
		info: (...params) => {
			call(`info`, params)
		},
		warn: (...params) => {
			call(`warn`, params)
		},
	}
}

function refreshEpoch(store: RootStore, child: ChildStore): void {
	const event = child.transactionMeta.update
	const currentEpoch = getEpochNumberOfAction(store, event.token.key)
	event.epoch = currentEpoch === undefined ? Number.NaN : currentEpoch + 1
}

function shouldQueueRootCommit(store: RootStore): boolean {
	return (
		store.operation.open ||
		store.on.transactionApplying.state !== null ||
		hasStateNotificationBatch(store) ||
		isTransactionCommitActive(store)
	)
}

function prepareCommit(
	store: RootStore,
	child: ChildStore,
	commitStrategy: TransactionCommitStrategy,
) {
	if (commitStrategy === `playback`) return null
	const prepared = prepareBatchedTransactionOutcomeEvent(
		store,
		child.transactionMeta.update,
	)
	if (!prepared.supported && commitStrategy === `batched`) {
		throw new Error(
			`Transaction "${child.transactionMeta.update.token.key}" requested a strict batched commit, but it ${prepared.reason}. Use "prefer-batched" to allow playback fallback.`,
		)
	}
	return prepared.supported ? prepared.plan : null
}

function commitRootTransaction(
	store: RootStore,
	child: ChildStore,
	commitStrategy: TransactionCommitStrategy,
): unknown[] {
	const plan = prepareCommit(store, child, commitStrategy)
	const transaction = withdraw<Fn>(store, child.transactionMeta.update.token)
	const previousApplying = store.on.transactionApplying.state
	const previousRootLogger = store.logger
	const previousChildLogger = child.logger
	const safeLogger = observerSafeLogger(previousRootLogger)
	let operation: RootStore[`operation`] | null = null
	let stagedPreviousValues: Map<string, any> | null = null
	let suspendedBatch: StateNotificationBatch | null = null
	let applyingRestored = false
	let notificationApplying = false
	let commitEnded = false

	beginTransactionCommit(store)
	store.logger = safeLogger
	child.logger = safeLogger
	try {
		const { errors } = collectObserverErrors(() => {
			try {
				store.on.transactionApplying.state = child.transactionMeta
				const { subEvents } = child.transactionMeta.update
				child.logger.info(
					`🛄`,
					`transaction`,
					child.transactionMeta.update.token.key,
					`applying ${subEvents.length} subEvents:`,
					subEvents,
				)

				if (plan) {
					operation = allowTransactionCommitStateOperations(
						store,
						() => installBatchedTransactionPlan(store, plan)?.operation ?? null,
					)
					refreshEpoch(store, child)
					setEpochNumberOfAction(
						store,
						child.transactionMeta.update.token.key,
						child.transactionMeta.update.epoch,
					)
					if (operation) {
						stagedPreviousValues = operation.prev
						suspendedBatch = suspendStateNotificationBatch(store)
					}
					store.on.transactionApplying.state = previousApplying
					applyingRestored = true
					if (operation) {
						closeOperation(store)
						operation = null
					}

					prepareTimelinesForTransaction(store, child.transactionMeta.update)
					notifySubjectSubscribers(
						transaction.subject,
						child.transactionMeta.update,
						(_key, subscriber) => isTimelineTransactionSubscriber(subscriber),
					)
					notifySubjectSubscribers(
						transaction.subject,
						child.transactionMeta.update,
						(_key, subscriber) => isRealtimeTransactionSubscriber(subscriber),
					)
					flushTransactionCommitObserverNotifications(store)

					if (suspendedBatch) {
						const firstUpdate = plan.finalUpdates.values().next().value!
						const deliveryTarget = allowTransactionCommitStateOperations(
							store,
							() => openOperation(store, firstUpdate.token),
						) as RootStore & {
							operation: OpenOperation
						}
						deliveryTarget.operation.prev = stagedPreviousValues!
						operation = deliveryTarget.operation
					}

					if (suspendedBatch) {
						store.on.transactionApplying.state = child.transactionMeta
						notificationApplying = true
						resumeStateNotificationBatch(store, suspendedBatch)
						suspendedBatch = null
						flushStateNotificationBatch(
							store,
							(_key, subscriber) => !isTimelineAtomSubscriber(subscriber),
						)
						store.on.transactionApplying.state = previousApplying
						notificationApplying = false
					}

					notifySubjectSubscribers(
						transaction.subject,
						child.transactionMeta.update,
						(key, subscriber) =>
							!isInternalTransactionSubscriber(key, subscriber),
					)

					if (operation) {
						closeOperation(store)
						operation = null
					}
				} else {
					allowTransactionCommitStateOperations(store, () => {
						ingestTransactionOutcomeEvent(
							store,
							child.transactionMeta.update,
							`newValue`,
						)
					})
					refreshEpoch(store, child)
					setEpochNumberOfAction(
						store,
						child.transactionMeta.update.token.key,
						child.transactionMeta.update.epoch,
					)
				}

				if (!applyingRestored) {
					store.on.transactionApplying.state = previousApplying
					applyingRestored = true
					transaction.subject.next(child.transactionMeta.update)
				}
				child.logger.info(
					`🛬`,
					`transaction`,
					child.transactionMeta.update.token.key,
					`applied`,
				)
			} finally {
				if (notificationApplying) {
					store.on.transactionApplying.state = previousApplying
					notificationApplying = false
				}
				if (operation) {
					cancelStateNotificationBatch(store)
					closeOperation(store)
					operation = null
				}
				if (!applyingRestored) {
					store.on.transactionApplying.state = previousApplying
					applyingRestored = true
				}
				flushTransactionCommitObserverNotifications(store)
				endTransactionCommit(store)
				commitEnded = true
				try {
					drainOperationQueue(store)
				} catch (error) {
					captureObserverError(error)
				}
			}
		})
		return errors
	} finally {
		if (!applyingRestored) {
			store.on.transactionApplying.state = previousApplying
		}
		if (!commitEnded) endTransactionCommit(store)
		store.logger = previousRootLogger
		child.logger = previousChildLogger
	}
}

function enqueueRootCommit(
	store: RootStore,
	child: ChildStore,
	commitStrategy: TransactionCommitStrategy,
): void {
	enqueueOperation(store, () => {
		const errors = commitRootTransaction(store, child, commitStrategy)
		if (errors.length > 0) {
			throw observerError(child.transactionMeta.update.token.key, errors)
		}
	})
}

function applyNestedTransaction(parent: ChildStore, child: ChildStore): void {
	const previousPhase = parent.transactionMeta.phase
	parent.transactionMeta.phase = `applying`
	try {
		ingestTransactionOutcomeEvent(
			parent,
			child.transactionMeta.update,
			`newValue`,
		)
		parent.transactionMeta.update.subEvents.push(child.transactionMeta.update)
	} finally {
		parent.transactionMeta.phase = previousPhase
	}
}

export function applyTransaction<F extends Fn>(
	store: ChildStore,
	output: ReturnType<F>,
	commitStrategy: TransactionCommitStrategy = `playback`,
): unknown[] {
	const child = newest(store)
	const { parent } = child

	child.transactionMeta.phase = `applying`
	child.transactionMeta.update.output = output

	if (isChildStore(parent)) {
		parent.child = null
		applyNestedTransaction(parent, child)
		return []
	}

	// Strict validation happens while the child is still attached, before any
	// mutation of the parent store.
	prepareCommit(parent, child, commitStrategy)
	parent.child = null
	if (shouldQueueRootCommit(parent)) {
		setQueuedTransactionBase(parent, child)
		enqueueRootCommit(parent, child, commitStrategy)
		return []
	}

	return commitRootTransaction(parent, child, commitStrategy)
}

export function createTransactionObserverError(
	transactionKey: string,
	errors: readonly unknown[],
): AggregateError {
	return observerError(transactionKey, errors)
}
