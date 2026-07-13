import type {
	TransactionOptions,
	TransactionOutcomeEvent,
	TransactionToken,
} from "atom.io"
import { Subject } from "atom.io/foundations/subject"

import { newest } from "../lineage.ts"
import { deposit } from "../store/index.ts"
import type { Fn } from "../utility-types.ts"
import { abortTransaction } from "./abort-transaction.ts"
import {
	applyTransaction,
	createTransactionObserverError,
} from "./apply-transaction.ts"
import { buildTransaction } from "./build-transaction.ts"
import type { ChildStore, RootStore } from "./is-root-store.ts"

function reportFailedTransaction(
	store: RootStore,
	target: ChildStore | undefined,
	key: string,
	thrown: unknown,
): never {
	const cleanupErrors: unknown[] = []
	if (target) {
		try {
			abortTransaction(target)
		} catch (cleanupError) {
			cleanupErrors.push(cleanupError)
		}
	}
	try {
		store.logger.warn(`💥`, `transaction`, key, `caught:`, thrown)
	} catch (cleanupError) {
		cleanupErrors.push(cleanupError)
	}
	if (cleanupErrors.length > 0) {
		throw new AggregateError(
			[thrown, ...cleanupErrors],
			`Transaction "${key}" failed while it was being aborted.`,
		)
	}
	throw thrown
}

export type Transaction<F extends Fn> = {
	key: string
	type: `transaction`
	install: (store: RootStore) => void
	subject: Subject<TransactionOutcomeEvent<TransactionToken<F>>>
	run: (parameters: Parameters<F>, id?: string) => ReturnType<F>
}

export function createTransaction<F extends Fn>(
	store: RootStore,
	options: TransactionOptions<F>,
): TransactionToken<F> {
	const { key } = options
	const transactionAlreadyExists = store.transactions.has(key)
	const newTransaction: Transaction<F> = {
		key,
		type: `transaction`,
		run: (params: Parameters<F>, id: string) => {
			const token = deposit(newTransaction)
			let target: ChildStore | undefined
			let output: ReturnType<F>
			let observerErrors: unknown[]
			try {
				target = buildTransaction(store, token, params, id)
				const { toolkit } = target.transactionMeta
				output = options.do(toolkit, ...params)
				observerErrors = applyTransaction<F>(
					target,
					output,
					options.commit ?? `playback`,
				)
			} catch (thrown) {
				return reportFailedTransaction(store, target, key, thrown)
			}
			if (observerErrors.length > 0) {
				throw createTransactionObserverError(key, observerErrors)
			}
			return output
		},
		install: (s) => createTransaction(s, options),
		subject: new Subject(),
	}
	const target = newest(store)
	target.transactions.set(key, newTransaction)
	const token = deposit(newTransaction)
	if (!transactionAlreadyExists) {
		store.on.transactionCreation.next(token)
	}
	return token
}
