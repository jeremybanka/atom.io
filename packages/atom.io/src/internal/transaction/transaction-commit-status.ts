import type {
	AtomToken,
	TransactionCommitEvent,
	TransactionCommitStateSnapshot,
	TransactionOutcomeEvent,
} from "atom.io"

import { isTransceiver } from "../mutable/index.ts"
import { deposit, type Store } from "../store/index.ts"
import type { ChildStore, RootStore } from "./is-root-store.ts"

const transactionCommitCounts = new WeakMap<Store, number>()

/** Monotonic structural commit signal for synchronous transaction callers. */
export function transactionCommitCount(store: Store): number {
	return transactionCommitCounts.get(store) ?? 0
}

export function markTransactionCommitted(store: Store): number {
	const sequence = transactionCommitCount(store) + 1
	transactionCommitCounts.set(store, sequence)
	return sequence
}

const commitEventOwners = new WeakMap<TransactionCommitEvent, Store>()

function cloneIsolated<Value>(value: Value): Value {
	if (value === undefined) return value
	try {
		return deepFreeze(structuredClone(value))
	} catch {
		return undefined as Value
	}
}

function deepFreeze<Value>(value: Value): Value {
	if (typeof value !== `object` || value === null || Object.isFrozen(value)) {
		return value
	}
	for (const child of Object.values(value)) deepFreeze(child)
	return Object.freeze(value)
}

function freezeOutcome(
	outcome: TransactionOutcomeEvent<any>,
): TransactionOutcomeEvent<any> {
	const subEvents = outcome.subEvents.map((subEvent) => {
		if (subEvent.type === `transaction_outcome`) return freezeOutcome(subEvent)
		if (`update` in subEvent) {
			return Object.freeze({
				...subEvent,
				update: Object.freeze(cloneIsolated(subEvent.update)),
			})
		}
		return Object.freeze({
			...subEvent,
			...(`value` in subEvent ? { value: cloneIsolated(subEvent.value) } : {}),
		})
	})
	return Object.freeze({
		...outcome,
		output: cloneIsolated(outcome.output),
		params: Object.freeze(cloneIsolated(outcome.params)),
		subEvents: Object.freeze(subEvents),
	}) as unknown as TransactionOutcomeEvent<any>
}

export function createTransactionCommitEvent(
	store: Store,
	outcome: TransactionOutcomeEvent<any>,
	sequence: number,
	snapshots: readonly TransactionCommitStateSnapshot[],
): TransactionCommitEvent {
	const event: TransactionCommitEvent = Object.freeze({
		outcome: freezeOutcome(outcome),
		sequence,
		snapshots: Object.freeze(
			snapshots.map((snapshot) =>
				Object.freeze({
					...snapshot,
					newValue: cloneIsolated(snapshot.newValue),
					oldValue: cloneIsolated(snapshot.oldValue),
				}),
			),
		),
		type: `transaction_commit`,
	})
	commitEventOwners.set(event, store)
	return event
}

function snapshotValue(value: unknown): unknown {
	return isTransceiver(value) ? value.toJSON() : value
}

/** Capture exact outer-boundary state before its child is ingested. */
export function captureTransactionCommitSnapshots(
	parent: RootStore,
	child: ChildStore,
	outcome: TransactionOutcomeEvent<any>,
): readonly TransactionCommitStateSnapshot[] {
	const snapshots = new Map<string, TransactionCommitStateSnapshot>()
	const capture = (event: TransactionOutcomeEvent<any>): void => {
		for (const subEvent of event.subEvents) {
			if (subEvent.type === `transaction_outcome`) {
				capture(subEvent)
				continue
			}
			let token: AtomToken<any, any, any> | undefined
			let eventValues:
				| { readonly newValue: unknown; readonly oldValue: unknown }
				| undefined
			if (
				subEvent.type === `atom_update` &&
				subEvent.token.key.startsWith(`*`)
			) {
				const mutable = child.atoms.get(subEvent.token.key.slice(1))
				if (mutable?.type === `mutable_atom`) token = deposit(mutable)
			} else if (subEvent.type === `atom_update`) {
				token = subEvent.token
				eventValues = {
					newValue: subEvent.update.newValue,
					oldValue: subEvent.update.oldValue,
				}
			} else if (subEvent.type === `mutable_atom_snapshot`) {
				token = subEvent.token
				eventValues = subEvent.update
			} else if (
				subEvent.type === `atom_creation` ||
				subEvent.type === `atom_disposal`
			) {
				token = subEvent.token
			}
			if (token === undefined) continue
			const previousSnapshot = snapshots.get(token.key)
			const oldExists = parent.atoms.has(token.key)
			const newExists = child.atoms.has(token.key)
			const oldValue =
				previousSnapshot === undefined
					? eventValues === undefined
						? oldExists
							? snapshotValue(parent.valueMap.get(token.key))
							: undefined
						: eventValues.oldValue
					: previousSnapshot.oldValue
			const newValue =
				eventValues === undefined
					? newExists
						? snapshotValue(child.valueMap.get(token.key))
						: undefined
					: eventValues.newValue
			snapshots.set(token.key, {
				newExists,
				newValue,
				oldExists: previousSnapshot?.oldExists ?? oldExists,
				oldValue,
				token,
			})
		}
	}
	capture(outcome)
	return [...snapshots.values()]
}

/** Verify the unforgeable Store ownership of a transaction commit event. */
export function assertTransactionCommitEventOwner(
	store: Store,
	event: TransactionCommitEvent,
): void {
	if (commitEventOwners.get(event) !== store) {
		throw new Error(`A transaction commit event does not belong to this Store.`)
	}
}
