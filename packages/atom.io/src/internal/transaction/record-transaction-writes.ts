import type { TransactionOutcomeEvent, TransactionToken } from "atom.io"

import { hasRole } from "../atom/has-role.ts"
import { isReservedIntrospectionKey } from "../reserved-keys.ts"
import { recordStoreChange } from "../store-observation.ts"
import type { Fn } from "../utility-types.ts"
import type { Transaction } from "./create-transaction.ts"
import type { ChildStore, RootStore } from "./is-root-store.ts"

type Outcome = TransactionOutcomeEvent<TransactionToken<any>>
const maxKeys = 1_000
const maxEvents = 10_000

/** Retain only keys, against the definitions that exist when the root commit succeeds. */
export function recordTransactionWrites(
	store: RootStore,
	child: ChildStore,
	outcome: Outcome,
): void {
	const frame = (event: Outcome) => ({
		transaction: store.transactions.get(event.token.key),
		events: event.subEvents,
		next: 0,
	})
	const record = (transaction: Transaction<Fn>, key?: string) => {
		if (isReservedIntrospectionKey(transaction.key)) return
		const writes = (transaction.observedWrites ??= {
			keys: new Set(),
			truncated: false,
		})
		if (key !== undefined && writes.keys.has(key)) return
		if (key === undefined || writes.keys.size === maxKeys) {
			if (writes.truncated) return
			writes.truncated = true
		} else writes.keys.add(key)
		recordStoreChange(store, `transactionWrites`, transaction.key)
	}

	const stack = [frame(outcome)]
	let inspected = 0
	while (stack.length) {
		const current = stack.at(-1)!
		if (current.next === current.events.length) {
			stack.pop()
			continue
		}
		if (inspected === maxEvents) {
			for (const { transaction } of stack) if (transaction) record(transaction)
			break
		}
		inspected++
		const event = current.events[current.next++]
		if (event.type === `transaction_outcome`) {
			stack.push(frame(event))
			continue
		}
		if (!(`token` in event)) continue
		let key = event.token.key
		const atom = child.atoms.get(key) ?? store.atoms.get(key)
		if (atom && hasRole(atom, `tracker:signal`)) key = key.slice(1)
		if (isReservedIntrospectionKey(key)) continue
		for (const { transaction } of stack)
			if (transaction) record(transaction, key)
	}
}
