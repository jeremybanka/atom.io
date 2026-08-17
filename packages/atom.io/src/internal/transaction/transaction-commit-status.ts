import type {
	AtomToken,
	TransactionCommitEvent,
	TransactionCommitIsolationFailure,
	TransactionCommitStateSnapshot,
	TransactionCommitUncloneableValue,
	TransactionOutcomeEvent,
} from "atom.io"

import { hasRole } from "../atom/index.ts"
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

function cloneIsolated<Value>(
	value: Value,
	path: string,
	failures: TransactionCommitIsolationFailure[],
): Value {
	try {
		return deepFreeze(structuredClone(value))
	} catch (error) {
		const failure = Object.freeze({
			path,
			reason:
				error instanceof Error
					? `${error.name}: ${error.message}`
					: String(error),
		})
		failures.push(failure)
		return Object.freeze({
			failure,
			type: `transaction_commit_uncloneable`,
		}) as TransactionCommitUncloneableValue as Value
	}
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
	if (typeof value !== `object` || value === null || Object.isFrozen(value)) {
		return value
	}
	if (seen.has(value)) return value
	seen.add(value)
	for (const child of Object.values(value)) deepFreeze(child, seen)
	return Object.freeze(value)
}

function freezeOutcome(
	outcome: TransactionOutcomeEvent<any>,
	failures: TransactionCommitIsolationFailure[],
	path = `outcome`,
): TransactionOutcomeEvent<any> {
	const subEvents = outcome.subEvents.map((subEvent, index) => {
		const subEventPath = `${path}.subEvents[${index}]`
		if (subEvent.type === `transaction_outcome`) {
			return freezeOutcome(subEvent, failures, subEventPath)
		}
		if (`update` in subEvent) {
			const oldValue =
				`oldValue` in subEvent.update
					? {
							oldValue: cloneIsolated(
								subEvent.update.oldValue,
								`${subEventPath}.update.oldValue`,
								failures,
							),
						}
					: {}
			return Object.freeze({
				...subEvent,
				update: Object.freeze({
					...oldValue,
					newValue: cloneIsolated(
						subEvent.update.newValue,
						`${subEventPath}.update.newValue`,
						failures,
					),
				}),
			})
		}
		return Object.freeze({
			...subEvent,
			...(`value` in subEvent
				? {
						value: cloneIsolated(
							subEvent.value,
							`${subEventPath}.value`,
							failures,
						),
					}
				: {}),
		})
	})
	return Object.freeze({
		...outcome,
		output: cloneIsolated(outcome.output, `${path}.output`, failures),
		params: Object.freeze(
			(outcome.params as unknown[]).map((param, index) =>
				cloneIsolated(param, `${path}.params[${index}]`, failures),
			),
		),
		subEvents: Object.freeze(subEvents),
	}) as unknown as TransactionOutcomeEvent<any>
}

export function createTransactionCommitEvent(
	store: Store,
	outcome: TransactionOutcomeEvent<any>,
	sequence: number,
	snapshots: readonly TransactionCommitStateSnapshot[],
): TransactionCommitEvent {
	const isolationFailures: TransactionCommitIsolationFailure[] = []
	const frozenOutcome = freezeOutcome(outcome, isolationFailures)
	const frozenSnapshots = snapshots.map((snapshot, index) =>
		Object.freeze({
			...snapshot,
			newValue: cloneIsolated(
				snapshot.newValue,
				`snapshots[${index}].newValue`,
				isolationFailures,
			),
			oldValue: cloneIsolated(
				snapshot.oldValue,
				`snapshots[${index}].oldValue`,
				isolationFailures,
			),
		}),
	)
	const event: TransactionCommitEvent = Object.freeze({
		isolationFailures: Object.freeze(isolationFailures),
		outcome: frozenOutcome,
		sequence,
		snapshots: Object.freeze(frozenSnapshots),
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
			const updatedAtom =
				subEvent.type === `atom_update`
					? child.atoms.get(subEvent.token.key)
					: undefined
			let token: AtomToken<any, any, any> | undefined
			let eventValues:
				| { readonly newValue: unknown; readonly oldValue: unknown }
				| undefined
			if (
				subEvent.type === `atom_update` &&
				updatedAtom !== undefined &&
				hasRole(updatedAtom, `tracker:signal`)
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
