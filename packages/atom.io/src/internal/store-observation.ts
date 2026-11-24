import type { TransactionOutcomeEvent, TransactionToken } from "atom.io"

import { isReservedIntrospectionKey } from "./reserved-keys.ts"
import type { Store } from "./store/index.ts"
import type { RootStore } from "./transaction/is-root-store.ts"

export type FutureActivity = `started` | `replaced` | `resolved` | `rejected`
type TransactionOutcome = TransactionOutcomeEvent<TransactionToken<any>>
type TransactionChanges = {
	registeredAt: number | undefined
	outcomes: TransactionOutcome[]
}

export interface StoreChanges {
	/** State keys whose cached value was written or removed. */
	readonly values: ReadonlySet<string>
	/** State keys registered, replaced, or disposed. */
	readonly states: ReadonlySet<string>
	/** Family keys registered or replaced. */
	readonly families: ReadonlySet<string>
	/** Selector keys whose observed incoming edges changed. */
	readonly dependencies: ReadonlySet<string>
	/** Timeline keys created, updated, or disposed. */
	readonly timelines: ReadonlySet<string>
	/** Transaction registrations and committed outcomes since the previous batch. */
	readonly transactions: ReadonlyMap<
		string,
		{
			/** Index of the first outcome after the latest registration, if any. */
			readonly registeredAt: number | undefined
			readonly outcomes: readonly TransactionOutcome[]
		}
	>
	/** Cache transitions, including Futures that settle within a single batch. */
	readonly futures: ReadonlyMap<string, ReadonlySet<FutureActivity>>
}

type Listener = (changes: StoreChanges) => void
type Edge = { upstream: string; downstream: string; source: string | undefined }
type Batch = {
	values: Set<string>
	states: Set<string>
	families: Set<string>
	edges: Map<string, Edge>
	futures: Map<string, Set<FutureActivity>>
	timelines: Set<string>
	transactions: Map<string, TransactionChanges>
}
export type StoreObservation = { listeners: Set<Listener>; batch?: Batch }

/**
 * Observe changes to the supplied root's state cache, definitions and retained
 * selector dependencies, timelines, and committed transactions. Delivery is batched in a microtask, after synchronous
 * writes and transaction replay. Observing does not read state or add state subscribers.
 * Keys reserved for introspection are omitted.
 */
export function observeStore(store: RootStore, listener: Listener): () => void {
	const observation = (store.observation ??= { listeners: new Set() })
	const { listeners } = observation
	const subscription: Listener = (changes) => {
		listener(changes)
	}
	listeners.add(subscription)
	return () => {
		listeners.delete(subscription)
		if (listeners.size === 0 && store.observation === observation)
			delete store.observation
	}
}

function getBatch(store: Store, observation: StoreObservation): Batch {
	if (observation.batch) return observation.batch
	const batch = {
		values: new Set<string>(),
		states: new Set<string>(),
		families: new Set<string>(),
		edges: new Map<string, Edge>(),
		futures: new Map<string, Set<FutureActivity>>(),
		timelines: new Set<string>(),
		transactions: new Map<string, TransactionChanges>(),
	}
	observation.batch = batch
	queueMicrotask(() => {
		delete observation.batch
		if (observation.listeners.size === 0) return
		const dependencies = new Set<string>()
		for (const { upstream, downstream, source } of batch.edges.values()) {
			const next = store.selectorGraph.getContent(upstream, downstream)?.source
			if (source === next) continue
			if (source !== undefined)
				dependencies.add(source === upstream ? downstream : upstream)
			if (next !== undefined)
				dependencies.add(next === upstream ? downstream : upstream)
		}
		for (const key of dependencies)
			if (isReservedIntrospectionKey(key)) dependencies.delete(key)
		const { values, states, families, futures, timelines, transactions } = batch
		if (
			values.size ||
			states.size ||
			families.size ||
			dependencies.size ||
			timelines.size ||
			transactions.size
		)
			for (const listener of [...observation.listeners])
				if (observation.listeners.has(listener))
					listener({
						values,
						states,
						families,
						dependencies,
						futures,
						timelines,
						transactions,
					})
	})
	return batch
}

export function recordFutureActivity(
	store: Store,
	key: string,
	activity: FutureActivity,
): void {
	const observation = store.observation
	if (!observation || isReservedIntrospectionKey(key)) return
	const { values, futures } = getBatch(store, observation)
	values.add(key)
	let events = futures.get(key)
	if (!events || activity === `started`) futures.set(key, (events = new Set()))
	events.add(activity)
}

export function recordStoreChange(
	store: Store,
	kind: `values` | `states` | `families` | `timelines`,
	key: string,
): void {
	const observation = store.observation
	if (observation && !isReservedIntrospectionKey(key))
		getBatch(store, observation)[kind].add(key)
}

export function recordTransactionRegistration(store: Store, key: string): void {
	const observation = store.observation
	if (!observation || isReservedIntrospectionKey(key)) return
	const change = transactionChanges(getBatch(store, observation), key)
	change.registeredAt = change.outcomes.length
}

export function recordTransactionOutcome(
	store: RootStore,
	outcome: TransactionOutcome,
): void {
	const observation = store.observation
	const key = outcome.token.key
	if (!observation || isReservedIntrospectionKey(key)) return
	transactionChanges(getBatch(store, observation), key).outcomes.push(outcome)
}

function transactionChanges(
	{ transactions }: Batch,
	key: string,
): TransactionChanges {
	let change = transactions.get(key)
	if (!change)
		transactions.set(key, (change = { registeredAt: undefined, outcomes: [] }))
	return change
}

/** Record the prior direction so a selector rebuilding its same edges is silent. */
export function recordDependencyChange(
	store: Store,
	upstream: string,
	downstream: string,
): void {
	const observation = store.observation
	if (!observation || isReservedIntrospectionKey(downstream)) return
	const { edges } = getBatch(store, observation)
	const id = store.selectorGraph.makeContentKey(upstream, downstream)
	if (!edges.has(id)) {
		const source = store.selectorGraph.getContent(upstream, downstream)?.source
		edges.set(id, { upstream, downstream, source })
	}
}

export function recordSelectorRemoval(store: Store, key: string): void {
	if (!store.observation) return
	const graph = store.selectorGraph
	for (const neighbor of graph.getRelatedKeys(key) ?? []) {
		const source = graph.getContent(key, neighbor)?.source
		if (source === key) recordDependencyChange(store, key, neighbor)
		else if (source === neighbor) recordDependencyChange(store, neighbor, key)
	}
}
