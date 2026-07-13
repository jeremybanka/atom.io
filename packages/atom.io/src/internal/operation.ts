import type { AtomCreationEvent, AtomUpdateEvent, ReadableToken } from "atom.io"

import { drainOperationQueue } from "./operation-queue.ts"
import type { Store } from "./store/index.ts"
import { isChildStore } from "./transaction/is-root-store.ts"
import {
	areTransactionCommitStateOperationsAllowed,
	isTransactionCommitActive,
} from "./transaction/transaction-commit-context.ts"
import { notifySubjectSubscribers } from "./transaction/transaction-observer-errors.ts"

export type OperationProgress =
	| OpenOperation<any>
	| {
			open: false
	  }
export type OpenOperation<
	R extends ReadableToken<any, any> = ReadableToken<any, any>,
> = {
	open: true
	token: R
	done: Set<string>
	prev: Map<string, any>
	timestamp: number
	subEvents: (AtomUpdateEvent<any> | AtomCreationEvent<any>)[]
}

export function openOperation(
	store: Store,
	token: ReadableToken<any, any, any>,
): number | (Store & { operation: OpenOperation }) {
	if (
		isTransactionCommitActive(store) &&
		!areTransactionCommitStateOperationsAllowed(store)
	) {
		const rejectionTime = performance.now()
		store.logger.info(
			`🚫`,
			token.type,
			token.key,
			`deferring setState at T-${rejectionTime} until the active transaction commit is done`,
		)
		return rejectionTime
	}
	if (store.operation.open) {
		const rejectionTime = performance.now()
		store.logger.info(
			`🚫`,
			token.type,
			token.key,
			`deferring setState at T-${rejectionTime} until setState for "${store.operation.token.key}" is done`,
		)
		return rejectionTime
	}
	store.operation = {
		open: true,
		done: new Set(),
		prev: new Map(),
		timestamp: Date.now(),
		token,
		subEvents: [],
	}
	try {
		store.logger.info(
			`⭕`,
			token.type,
			token.key,
			`operation start in store "${store.config.name}"${
				isChildStore(store)
					? ` ${store.transactionMeta.phase} "${store.transactionMeta.update.token.key}"`
					: ``
			}`,
		)
	} catch (error) {
		store.operation = { open: false }
		const cleanupErrors: unknown[] = []
		try {
			notifySubjectSubscribers(store.on.operationClose, store.operation)
		} catch (cleanupError) {
			cleanupErrors.push(cleanupError)
		}
		try {
			drainOperationQueue(store)
		} catch (cleanupError) {
			cleanupErrors.push(cleanupError)
		}
		if (cleanupErrors.length > 0) {
			throw new AggregateError(
				[error, ...cleanupErrors],
				`Opening operation "${token.key}" failed`,
			)
		}
		throw error
	}
	return store as Store & { operation: OpenOperation }
}

export function closeOperation(store: Store): void {
	const operation = store.operation
	store.operation = { open: false }
	const errors: unknown[] = []
	if (operation.open) {
		try {
			store.logger.info(
				`🔴`,
				operation.token.type,
				operation.token.key,
				`operation done in store "${store.config.name}"`,
			)
		} catch (error) {
			errors.push(error)
		}
	}
	try {
		notifySubjectSubscribers(store.on.operationClose, store.operation)
	} catch (error) {
		errors.push(error)
	}
	try {
		drainOperationQueue(store)
	} catch (error) {
		errors.push(error)
	}
	if (errors.length === 1) throw errors[0]
	if (errors.length > 1) {
		throw new AggregateError(errors, `Closing an operation failed`)
	}
}

export function isDone(store: Store, key: string): boolean {
	if (!store.operation.open) {
		store.logger.error(
			`🐞`,
			`unknown`,
			key,
			`isDone called outside of an operation. This is probably a bug in AtomIO.`,
		)
		return true
	}
	return store.operation.done.has(key)
}
export function markDone(store: Store, key: string): void {
	if (!store.operation.open) {
		store.logger.error(
			`🐞`,
			`unknown`,
			key,
			`markDone called outside of an operation. This is probably a bug in AtomIO.`,
		)
		return
	}
	store.operation.done.add(key)
}
