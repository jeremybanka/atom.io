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
import type { RecordedEvent } from "./history-event.ts"
import { getIntrospectionStates } from "./store.ts"
import { projectWorkerEcology } from "./worker-ecology.ts"
import type {
	WorkerCachedValue,
	WorkerHistoryUpdate,
	WorkerStateToken,
	WorkerStoreSnapshot,
	WorkerStoreUpdate,
} from "./worker-protocol.ts"

type StateEntry = {
	token: WorkerStateToken
	source: WorkerStateToken
	cache: RegularAtomToken<WorkerCachedValue>
	revision: number | undefined
}
interface WorkerProjection {
	apply(snapshot: WorkerStoreSnapshot): void
	update(update: WorkerStoreUpdate): void
	cache(key: string): RegularAtomToken<WorkerCachedValue> | undefined
	revision(key: string): number | undefined
	timelineRevision(key: string): number | undefined
	ecology(): EcologySnapshot | undefined
	subscribeEcology(listener: () => void): () => void
}
const emptyProjectionValue = (): undefined => undefined

/** A projection contains no application functions. The worker executes every command. */
export function createWorkerProjection(silo: Silo): WorkerProjection {
	const { store } = silo
	const states = new Map<string, StateEntry>()
	const timelineRevisions = new Map<string, number>()
	let ecology: ReturnType<typeof projectWorkerEcology> | undefined
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
		return {
			token,
			source: remote,
			cache,
			revision: undefined,
		}
	}

	function apply(snapshot: WorkerStoreSnapshot) {
		const { transactionIndex, timelineIndex } = getIntrospectionStates(store)
		// Initialize before publishing creation events. The default scans all registered owners.
		silo.getState(transactionIndex)
		silo.getState(timelineIndex)
		ecology = projectWorkerEcology(snapshot.ecology)
		update({
			states: snapshot.states,
			removedStates: [],
			timelines: snapshot.timelines.map((timeline) => ({
				...timeline,
				history: { start: 0, length: 0, append: timeline.history },
			})),
			removedTimelines: [],
			transactions: snapshot.transactions.map((transaction) => ({
				...transaction,
				history: { start: 0, length: 0, append: transaction.history },
			})),
		})
	}

	function readHistory<T extends RecordedEvent>(
		previous: readonly T[],
		{ start, length, append }: WorkerHistoryUpdate<T>,
	): T[] {
		return previous.slice(start, start + length).concat(append)
	}

	function update(change: WorkerStoreUpdate) {
		for (const key of change.removedStates) {
			const entry = states.get(key)!
			removeState(entry)
			states.delete(key)
		}
		for (const { token, cache, revision, editable } of change.states) {
			let entry = states.get(token.key)
			if (
				entry &&
				(entry.source.type !== token.type ||
					entry.source.family?.key !== token.family?.key ||
					entry.source.family?.subKey !== token.family?.subKey)
			) {
				removeState(entry)
				entry = undefined
			}
			if (!entry) {
				entry = addState(token)
				states.set(token.key, entry)
			}
			entry.revision = editable ? revision : undefined
			if (cache.status === `value`) setCachedValue(store, token.key, cache.value)
			else deleteCachedValue(store, token.key)
			silo.setState(entry.cache, () => cache)
		}

		for (const key of change.removedTimelines) {
			timelineRevisions.delete(key)
			silo.disposeTimeline(store.timelines.get(key)!)
		}
		for (const { token, at, revision, history } of change.timelines) {
			timelineRevisions.set(token.key, revision)
			if (!store.timelines.has(token.key))
				createTimeline(
					store,
					{ key: token.key, scope: [] },
					undefined,
					token.family,
				)
			const timeline = store.timelines.get(token.key)!
			const historyChanged =
				timeline.history.length !== history.length || history.append.length > 0
			if (at === timeline.at && !historyChanged) continue
			if (historyChanged)
				timeline.history = readHistory(timeline.history, history)
			timeline.at = at
			timeline.subject.next({
				type: `timeline_update`,
				event: `clear`,
				at,
				length: timeline.history.length,
			})
		}
		for (const { token, history } of change.transactions) {
			const { transactionLogSelectors } = getIntrospectionStates(store)
			if (!store.transactions.has(token.key))
				createTransaction(store, { key: token.key, do: emptyProjectionValue })
			const log = silo.getState(transactionLogSelectors, token.key)
			if (log.length === history.length && history.append.length === 0) continue
			const backing: RegularAtomToken<typeof log> = {
				type: `atom`,
				key:
					`🔍 Transaction Update Log (Internal)(` +
					JSON.stringify(token.key) +
					`)`,
			}
			silo.setState(backing, () => readHistory(log, history))
		}
		if (change.ecology && ecology!.update(change.ecology))
			for (const listener of listeners) listener()
	}

	return {
		apply,
		update,
		cache(key: string) {
			return states.get(key)?.cache
		},
		revision(key: string) {
			return states.get(key)?.revision
		},
		timelineRevision(key: string) {
			return timelineRevisions.get(key)
		},
		ecology: () => ecology?.read(),
		subscribeEcology(listener: () => void) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
	}
}
