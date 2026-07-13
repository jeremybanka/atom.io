import type { Store } from "../store/index.ts"
import type { ChildStore, RootStore } from "./is-root-store.ts"

const activeTransactionCommits = new WeakMap<
	Store,
	{ allowStateOperations: boolean; observerNotifications: (() => void)[] }
>()
const queuedTransactionBases = new WeakMap<RootStore, ChildStore>()

export function beginTransactionCommit(store: Store): void {
	activeTransactionCommits.set(store, {
		allowStateOperations: false,
		observerNotifications: [],
	})
}

export function endTransactionCommit(store: Store): void {
	activeTransactionCommits.delete(store)
}

export function isTransactionCommitActive(store: Store): boolean {
	return activeTransactionCommits.has(store)
}

export function areTransactionCommitStateOperationsAllowed(
	store: Store,
): boolean {
	return activeTransactionCommits.get(store)?.allowStateOperations ?? true
}

export function allowTransactionCommitStateOperations<T>(
	store: Store,
	run: () => T,
): T {
	const context = activeTransactionCommits.get(store)!
	context.allowStateOperations = true
	try {
		return run()
	} finally {
		context.allowStateOperations = false
	}
}

export function deferTransactionCommitObserverNotification(
	store: Store,
	notify: () => void,
): boolean {
	const context = activeTransactionCommits.get(store)
	if (!context) return false
	context.observerNotifications.push(notify)
	return true
}

export function flushTransactionCommitObserverNotifications(store: Store): void {
	const notifications =
		activeTransactionCommits.get(store)!.observerNotifications
	for (const notify of notifications.splice(0)) notify()
}

export function getQueuedTransactionBase(
	store: RootStore,
): ChildStore | undefined {
	return queuedTransactionBases.get(store)
}

export function setQueuedTransactionBase(
	store: RootStore,
	base: ChildStore,
): void {
	queuedTransactionBases.set(store, base)
}

export function clearQueuedTransactionBase(store: RootStore): void {
	queuedTransactionBases.delete(store)
}
