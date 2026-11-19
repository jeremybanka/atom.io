import type { RegularAtomToken, SelectorToken, Silo } from "atom.io"
import {
	createReadonlyPureSelector,
	createRegularAtom,
	createTimeline,
	createTransaction,
	createWritablePureSelector,
	deleteCachedValue,
	setCachedValue,
} from "atom.io/internal"

import type { EcologySnapshot } from "./ecology.ts"
import type { RecordedEvent } from "./history-search.ts"
import { getIntrospectionStates } from "./store.ts"
import type {
	WorkerCachedValue,
	WorkerHistory,
	WorkerStateToken,
	WorkerStoreSnapshot,
} from "./worker-protocol.ts"

type StateEntry = {
	token: WorkerStateToken
	cache: RegularAtomToken<WorkerCachedValue>
	revision: number | undefined
	observed: number | undefined
}
interface WorkerProjection {
	apply(snapshot: WorkerStoreSnapshot): void
	cache(key: string): RegularAtomToken<WorkerCachedValue> | undefined
	revision(key: string): number | undefined
	ecology(): EcologySnapshot | undefined
	subscribeEcology(listener: () => void): () => void
}
const emptyProjectionValue = (): undefined => undefined

/** A projection contains no application functions. The worker executes every command. */
export function createWorkerProjection(silo: Silo): WorkerProjection {
	const { store } = silo
	const states = new Map<string, StateEntry>()
	let history = new Map<string, RecordedEvent>()
	let ecology: EcologySnapshot | undefined
	let topology: string | undefined
	const listeners = new Set<() => void>()

	function removeState({ token, cache }: StateEntry) {
		store.atoms.delete(cache.key)
		deleteCachedValue(store, cache.key)
		deleteCachedValue(store, token.key)
		if (token.type === `atom`) {
			store.atoms.delete(token.key)
			if (!token.family) {
				const { atomIndex } = getIntrospectionStates(store)
				silo.setState(
					atomIndex as RegularAtomToken<Map<string, unknown>>,
					(index) => {
						const next = new Map(index)
						next.delete(token.key)
						return next
					},
				)
			} else store.on.atomDisposal.next(token)
		} else {
			store.readonlySelectors.delete(token.key)
			store.writableSelectors.delete(token.key)
			store.on.selectorDisposal.next(token as SelectorToken<unknown>)
		}
	}

	function addState(remote: WorkerStateToken): StateEntry {
		const { key, family } = remote
		let token: WorkerStateToken
		if (remote.type === `atom` || remote.type === `mutable_atom`) {
			token = createRegularAtom(store, { key, default: undefined }, family)
		} else {
			const options = { key, get: emptyProjectionValue }
			token = remote.type.startsWith(`writable`)
				? createWritablePureSelector(
						store,
						{ ...options, set: emptyProjectionValue },
						family,
					)
				: createReadonlyPureSelector(store, options, family)
			store.on.selectorCreation.next(token)
		}
		const cache = createRegularAtom<WorkerCachedValue, never, never>(
			store,
			{
				key: `🔍 Worker projection ` + key,
				default: { status: `uncached` },
			},
			undefined,
		)
		return { token, cache, revision: undefined, observed: undefined }
	}

	function apply(snapshot: WorkerStoreSnapshot) {
		const { transactionIndex, transactionLogSelectors, timelineIndex } =
			getIntrospectionStates(store)
		// Initialize before publishing creation events. The default scans all registered owners.
		silo.getState(transactionIndex)
		silo.getState(timelineIndex)
		const current = new Set(snapshot.states.map(({ token }) => token.key))
		for (const [key, entry] of states) {
			if (current.has(key)) continue
			removeState(entry)
			states.delete(key)
		}
		for (const { token, cache, revision, editable } of snapshot.states) {
			let entry = states.get(token.key)
			if (!entry) {
				entry = addState(token)
				states.set(token.key, entry)
			}
			if (entry.observed === revision) continue
			entry.observed = revision
			entry.revision = editable ? revision : undefined
			if (cache.status === `value`) setCachedValue(store, token.key, cache.value)
			else deleteCachedValue(store, token.key)
			silo.setState(entry.cache, () => cache)
		}

		const nextHistory = new Map<string, RecordedEvent>()
		const readHistory = <T extends RecordedEvent>(
			records: WorkerHistory<T>[],
		): T[] =>
			records.map(({ id, event }) => {
				const stable = (history.get(id) as T | undefined) ?? event
				nextHistory.set(id, stable)
				return stable
			})
		const currentTimelines = new Set(
			snapshot.timelines.map(({ token }) => token.key),
		)
		for (const token of store.timelines.values()) {
			if (!currentTimelines.has(token.key)) silo.disposeTimeline(token)
		}
		for (const { token, at, history: records } of snapshot.timelines) {
			if (!store.timelines.has(token.key))
				createTimeline(
					store,
					{ key: token.key, scope: [] },
					undefined,
					token.family,
				)
			const timeline = store.timelines.get(token.key)!
			const events = readHistory(records)
			if (
				at === timeline.at &&
				events.length === timeline.history.length &&
				events.every((event, index) => event === timeline.history[index])
			)
				continue
			timeline.at = at
			timeline.history = events
			timeline.subject.next({
				type: `timeline_update`,
				event: `clear`,
				at,
				length: events.length,
			})
		}
		for (const { token, history: records } of snapshot.transactions) {
			if (!store.transactions.has(token.key))
				createTransaction(store, { key: token.key, do: emptyProjectionValue })
			const events = readHistory(records)
			const log = silo.getState(transactionLogSelectors, token.key)
			if (
				events.length === log.length &&
				events.every((event, index) => event === log[index])
			)
				continue
			const backing: RegularAtomToken<typeof log> = {
				type: `atom`,
				key:
					`🔍 Transaction Update Log (Internal)(` +
					JSON.stringify(token.key) +
					`)`,
			}
			silo.setState(backing, () => events)
		}
		history = nextHistory

		ecology = snapshot.ecology
		const nextTopology = JSON.stringify([
			ecology.edges,
			ecology.families,
			ecology.nodes.map(({ key, dependencies, dependenciesTruncated }) => [
				key,
				dependencies,
				dependenciesTruncated,
			]),
		])
		if (topology !== nextTopology) {
			topology = nextTopology
			for (const listener of listeners) listener()
		}
	}

	return {
		apply,
		cache(key: string) {
			return states.get(key)?.cache
		},
		revision(key: string) {
			return states.get(key)?.revision
		},
		ecology: () => ecology,
		subscribeEcology(listener: () => void) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
	}
}
