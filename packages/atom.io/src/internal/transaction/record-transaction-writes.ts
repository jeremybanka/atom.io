import type { TransactionOutcomeEvent, TransactionToken } from "atom.io"

import { hasRole } from "../atom/has-role.ts"
import { isReservedIntrospectionKey } from "../reserved-keys.ts"
import { recordStoreChange } from "../store-observation.ts"
import type { Fn } from "../utility-types.ts"
import type { Transaction } from "./create-transaction.ts"
import type { RootStore } from "./is-root-store.ts"

type Outcome = TransactionOutcomeEvent<TransactionToken<any>>
const maxKeys = 1_000
const maxEvents = 10_000
const writersByStore = new WeakMap<
	RootStore[`transactions`],
	Map<string, Set<string>>
>()

export function forgetAtomWrites(store: RootStore, key: string): void {
	const index = writersByStore.get(store.transactions)
	const writers = index?.get(key)
	if (!writers) return
	index!.delete(key)
	for (const transaction of writers) {
		const writes = store.transactions.get(transaction)!.observedWrites!
		writes.keys.delete(key)
		writes.truncated = false
		recordStoreChange(store, `transactionWrites`, transaction)
	}
}

export function forgetTransactionWrites(store: RootStore, key: string): void {
	const writes = store.transactions.get(key)?.observedWrites
	if (!writes) return
	const index = writersByStore.get(store.transactions)!
	for (const atom of writes.keys) {
		const writers = index.get(atom)!
		writers.delete(key)
		if (!writers.size) index.delete(atom)
	}
}

/** Track committed writes only while the store is being observed. */
export function recordTransactionWrites(
	store: RootStore,
	outcome: Outcome,
): void {
	if (!store.observation) return
	let index = writersByStore.get(store.transactions)
	if (!index) writersByStore.set(store.transactions, (index = new Map()))
	const writersByAtom = index
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
		} else {
			writes.keys.add(key)
			let writers = writersByAtom.get(key)
			if (!writers) writersByAtom.set(key, (writers = new Set()))
			writers.add(transaction.key)
		}
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
		if (event.type !== `atom_update` && event.type !== `mutable_atom_snapshot`)
			continue
		let key = event.token.key
		const atom = store.atoms.get(key)
		if (atom && hasRole(atom, `tracker:signal`)) key = key.slice(1)
		if (isReservedIntrospectionKey(key) || !store.atoms.has(key)) continue
		for (const { transaction } of stack)
			if (transaction) record(transaction, key)
	}
}
