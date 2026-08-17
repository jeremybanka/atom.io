import type { Store } from "../store/index.ts"

const transactionCommitCounts = new WeakMap<Store, number>()

/** Monotonic structural commit signal for synchronous transaction callers. */
export function transactionCommitCount(store: Store): number {
	return transactionCommitCounts.get(store) ?? 0
}

export function markTransactionCommitted(store: Store): void {
	transactionCommitCounts.set(store, transactionCommitCount(store) + 1)
}
