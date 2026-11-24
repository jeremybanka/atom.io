import type {
	RegularAtomToken,
	Silo,
	TimelineToken,
	TransactionOutcomeEvent,
	TransactionToken,
} from "atom.io"
import {
	createReadonlyPureSelector,
	createRegularAtom,
	createWritablePureSelector,
	deleteCachedValue,
	setCachedValue,
} from "atom.io/internal"

import type { EcologySnapshot } from "./ecology.ts"
import type { RecordedEvent } from "./history-event.ts"
import { projectRemoteEcology } from "./remote-ecology.ts"
import type {
	RemoteCachedValue,
	RemoteHistoryUpdate,
	RemoteStateToken,
	RemoteStoreSnapshot,
	RemoteStoreUpdate,
} from "./remote-protocol.ts"
import type { StateTokenIndex, StoreViews, TimelineView } from "./store.ts"

type StateEntry = {
	source: RemoteStateToken
	cache: RegularAtomToken<RemoteCachedValue>
	revision: number | undefined
}
type TransactionHistory = readonly TransactionOutcomeEvent<
	TransactionToken<any>
>[]
interface RemoteProjection {
	views: StoreViews
	apply(snapshot: RemoteStoreSnapshot): void
	update(update: RemoteStoreUpdate): void
	updateStates(states: RemoteStoreUpdate[`states`]): void
	cache(key: string): RegularAtomToken<RemoteCachedValue> | undefined
	revision(key: string): number | undefined
	timelineRevision(key: string): number | undefined
	ecology(): EcologySnapshot | undefined
	subscribeEcology(listener: () => void): () => void
}
const emptyProjectionValue = (): undefined => undefined

/** Keep the panel's reactive views independent of the local introspection attachments. */
export function createRemoteProjection(silo: Silo): RemoteProjection {
	const { store } = silo
	const states = new Map<string, StateEntry>()
	const timelines = new Map<
		string,
		{ view: RegularAtomToken<TimelineView>; revision: number }
	>()
	const transactions = new Map<string, RegularAtomToken<TransactionHistory>>()
	let ecology: ReturnType<typeof projectRemoteEcology> | undefined
	const listeners = new Set<() => void>()

	const owned = <T>(key: string, initial: T): RegularAtomToken<T> =>
		createRegularAtom(
			store,
			{ key: `🔍 Remote devtools ` + key, default: () => initial },
			undefined,
		)
	const atomIndex = owned<StateTokenIndex>(`atoms`, new Map())
	const selectorIndex = owned<StateTokenIndex>(`selectors`, new Map())
	const pendingIndexes = new Map<
		RegularAtomToken<StateTokenIndex>,
		{
			entries: StateTokenIndex
			families: Set<string>
		}
	>()
	const timelineIndex = owned<TimelineToken<any>[]>(`timelines`, [])
	const transactionIndex = owned<TransactionToken<any>[]>(`transactions`, [])

	function discardAtom(token: RegularAtomToken<any>) {
		store.atoms.delete(token.key)
		deleteCachedValue(store, token.key)
	}

	function indexState(token: RemoteStateToken, present: boolean) {
		const index = token.type.includes(`selector`) ? selectorIndex : atomIndex
		let pending = pendingIndexes.get(index)
		if (!pending) {
			pending = { entries: new Map(silo.getState(index)), families: new Set() }
			pendingIndexes.set(index, pending)
		}
		const next = pending.entries
		if (token.family) {
			const { key, subKey } = token.family
			const group = next.get(key)
			const previous =
				group && `familyMembers` in group ? group.familyMembers : undefined
			const familyMembers =
				previous && pending.families.has(key) ? previous : new Map(previous)
			pending.families.add(key)
			if (present) familyMembers.set(subKey, token)
			else familyMembers.delete(subKey)
			if (familyMembers.size > 0) next.set(key, { key, familyMembers })
			else next.delete(key)
		} else if (present) next.set(token.key, token)
		else next.delete(token.key)
	}

	function removeState({ source, cache }: StateEntry) {
		discardAtom(cache)
		deleteCachedValue(store, source.key)
		store.atoms.delete(source.key)
		store.readonlySelectors.delete(source.key)
		store.writableSelectors.delete(source.key)
		indexState(source, false)
	}

	function addState(source: RemoteStateToken): StateEntry {
		const { key, family } = source
		// Ecology's editor still reads cached values and definition identity from this Silo.
		if (source.type === `atom` || source.type === `mutable_atom`)
			createRegularAtom(store, { key, default: undefined }, family)
		else {
			const options = { key, get: emptyProjectionValue }
			if (source.type.startsWith(`writable`))
				createWritablePureSelector(
					store,
					{ ...options, set: emptyProjectionValue },
					family,
				)
			else createReadonlyPureSelector(store, options, family)
		}
		const cache = owned<RemoteCachedValue>(`state ` + key, {
			status: `uncached`,
		})
		indexState(source, true)
		return { source, cache, revision: undefined }
	}

	function updateStates(changed: RemoteStoreUpdate[`states`]) {
		for (const { token, cache, revision, editable } of changed) {
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
		for (const [index, pending] of pendingIndexes)
			silo.setState(index, pending.entries)
		pendingIndexes.clear()
	}

	function apply(snapshot: RemoteStoreSnapshot) {
		ecology = projectRemoteEcology(snapshot.ecology)
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
		{ start, length, append }: RemoteHistoryUpdate<T>,
	): T[] {
		return previous.slice(start, start + length).concat(append)
	}

	function update(change: RemoteStoreUpdate) {
		for (const key of change.removedStates) {
			removeState(states.get(key)!)
			states.delete(key)
		}
		updateStates(change.states)
		for (const key of change.removedTimelines) {
			discardAtom(timelines.get(key)!.view)
			timelines.delete(key)
			silo.setState(timelineIndex, (index) =>
				index.filter((token) => token.key !== key),
			)
		}
		for (const { token, at, revision, history } of change.timelines) {
			let entry = timelines.get(token.key)
			if (!entry) {
				entry = {
					view: owned<TimelineView>(`timeline ` + token.key, {
						at: 0,
						history: [],
					}),
					revision,
				}
				timelines.set(token.key, entry)
				silo.setState(timelineIndex, (index) => [...index, token])
			}
			entry.revision = revision
			const previous = silo.getState(entry.view)
			const historyChanged =
				previous.history.length !== history.length || history.append.length > 0
			if (at !== previous.at || historyChanged)
				silo.setState(entry.view, {
					at,
					history: historyChanged
						? readHistory(previous.history, history)
						: previous.history,
				})
		}
		for (const { token, history } of change.transactions) {
			let view = transactions.get(token.key)
			if (!view) {
				view = owned<TransactionHistory>(`transaction ` + token.key, [])
				transactions.set(token.key, view)
				silo.setState(transactionIndex, (index) => [...index, token])
			}
			const previous = silo.getState(view)
			if (previous.length !== history.length || history.append.length > 0)
				silo.setState(view, () => readHistory(previous, history))
		}
		if (change.ecology && ecology!.update(change.ecology))
			for (const listener of listeners) listener()
	}

	return {
		views: {
			atomIndex,
			selectorIndex,
			transactionIndex,
			timelineIndex,
			transactionLog: (key) => transactions.get(key)!,
			timelineLog: (key) => timelines.get(key)!.view,
		},
		apply,
		update,
		updateStates,
		cache: (key) => states.get(key)?.cache,
		revision: (key) => states.get(key)?.revision,
		timelineRevision: (key) => timelines.get(key)?.revision,
		ecology: () => ecology?.read(),
		subscribeEcology(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
	}
}
