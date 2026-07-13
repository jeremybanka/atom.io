import { hasStateNotificationBatch } from "./state-notification-batch.ts"
import type { Store } from "./store/index.ts"
import type { RootStore } from "./transaction/is-root-store.ts"
import {
	clearQueuedTransactionBase,
	isTransactionCommitActive,
} from "./transaction/transaction-commit-context.ts"

type QueuedOperation = () => void

const operationQueues = new WeakMap<Store, QueuedOperation[]>()
const drainingOperationQueues = new WeakSet<Store>()

export function enqueueOperation(
	store: Store,
	operation: QueuedOperation,
): void {
	let queue = operationQueues.get(store)
	if (!queue) {
		queue = []
		operationQueues.set(store, queue)
	}
	queue.push(operation)
}

export function hasQueuedOperation(store: Store): boolean {
	return (operationQueues.get(store)?.length ?? 0) > 0
}

export function drainOperationQueue(store: Store): void {
	if (
		drainingOperationQueues.has(store) ||
		store.operation.open ||
		store.on.transactionApplying.state !== null ||
		hasStateNotificationBatch(store) ||
		isTransactionCommitActive(store)
	) {
		return
	}

	const queue = operationQueues.get(store)
	if (!queue) return

	drainingOperationQueues.add(store)
	const errors: unknown[] = []
	try {
		while (queue.length > 0) {
			const operation = queue.shift()!
			try {
				operation()
			} catch (error) {
				errors.push(error)
			}
			if (
				store.operation.open ||
				store.on.transactionApplying.state !== null ||
				hasStateNotificationBatch(store) ||
				isTransactionCommitActive(store)
			) {
				break
			}
		}
	} finally {
		drainingOperationQueues.delete(store)
		if (queue.length === 0) {
			operationQueues.delete(store)
			clearQueuedTransactionBase(store as RootStore)
		}
	}

	if (errors.length === 1) throw errors[0]
	if (errors.length > 1) {
		throw new AggregateError(errors, `Deferred operations failed`)
	}
}
