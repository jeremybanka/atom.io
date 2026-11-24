import type {
	Silo,
	TimelineEvent,
	TransactionOutcomeEvent,
	TransactionToken,
	WritableToken,
} from "atom.io"
import { Future } from "atom.io/foundations/future"
import {
	arbitrary,
	deposit,
	disposeFromStore,
	isReservedIntrospectionKey,
	subscribeToState,
} from "atom.io/internal"
import {
	observeStore,
	peekState,
	peekStateDefinition,
} from "atom.io/introspection"

import type { RecordedEvent } from "./history-event.ts"
import {
	batchDevtoolsUpdates,
	closeDevtoolsTransport,
	type DevtoolsStoreTransport,
	reportDevtoolsError,
} from "./transport.ts"
import { trackRemoteEcology } from "./remote-ecology.ts"
import { REMOTE_PROTOCOL_VERSION } from "./remote-protocol.ts"
import type {
	PanelMessage,
	RemoteHistoryUpdate,
	RemoteStateToken,
	RemoteStoreSnapshot,
	RemoteStoreUpdate,
} from "./remote-protocol.ts"

function isEditableValue(value: unknown): boolean {
	const pending = [value]
	const seen = new Set<object>()
	while (pending.length) {
		const next = pending.pop()
		if (
			next === null ||
			typeof next === `string` ||
			typeof next === `boolean` ||
			(typeof next === `number` && Number.isFinite(next))
		)
			continue
		if (typeof next !== `object` || seen.has(next)) return false
		const prototype: object | null = Object.getPrototypeOf(next)
		if (
			Array.isArray(next)
				? !Array.isArray(prototype)
				: prototype !== null && Object.getPrototypeOf(prototype) !== null
		)
			return false
		seen.add(next)
		for (const descriptor of Object.values(
			Object.getOwnPropertyDescriptors(next),
		)) {
			if (!descriptor.enumerable) continue
			if (!(`value` in descriptor)) return false
			pending.push(descriptor.value)
		}
	}
	return true
}

function copyValue(value: unknown): unknown {
	try {
		return structuredClone(value)
	} catch {
		return new Error(`Value could not be transferred from the remote store`)
	}
}

function copyEvent<T extends RecordedEvent>(event: T): T {
	const copy = { ...event }
	if (`subEvents` in copy)
		copy.subEvents = copy.subEvents.map(copyEvent) as typeof copy.subEvents
	if (`update` in copy)
		copy.update = {
			oldValue: copyValue(copy.update.oldValue),
			newValue: copyValue(copy.update.newValue),
		} as typeof copy.update
	if (`params` in copy) copy.params = copy.params.map(copyValue)
	if (`output` in copy) copy.output = copyValue(copy.output)
	if (`value` in copy) copy.value = copyValue(copy.value)
	if (`values` in copy)
		copy.values = copyValue(copy.values) as typeof copy.values
	return copy
}

function visible(key: string): boolean {
	return !isReservedIntrospectionKey(key) && !key.startsWith(`👁‍🗨`)
}

/** Owns subscriptions and state operations for a fully exposed worker Silo. */
export function exposeWholeStore(
	transport: DevtoolsStoreTransport,
	silo: Silo,
	control: boolean,
): () => void {
	const { store } = silo
	const watches = new Map<string, { ids: Set<number>; stop(): void }>()
	const revisions = new Map<string, number>()
	const changedStates = new Set<string>()
	const changedDefinitions = new Set<string>()
	const changedFamilies = new Set<string>()
	const changedDependencies = new Set<string>()
	const changedTimelines = new Set<string>()
	const changedTransactions = new Set<string>()
	const sentStates = new Set<string>()
	const sentTimelines = new Map<string, readonly TimelineEvent<any>[]>()
	const sentTransactions = new Map<
		string,
		readonly TransactionOutcomeEvent<TransactionToken<any>>[]
	>()
	const ecology = trackRemoteEcology(store)
	const cleanup: (() => void)[] = []
	const timelineRevisions = new Map<string, number>()
	const transactions = new Map<
		string,
		TransactionOutcomeEvent<TransactionToken<any>>[]
	>()
	let timelineRevision = 0
	let closed = false
	let sequence = 0
	const subscriber = arbitrary()
	function readState(
		definition: NonNullable<ReturnType<typeof peekStateDefinition>>,
	): RemoteStoreSnapshot[`states`][number] {
		const { key, type } = definition
		const token: RemoteStateToken = deposit(definition)
		const cached = peekState(store, key)
		const value =
			cached.value instanceof Future
				? new Error(`Remote value is pending`)
				: copyValue(cached.value)
		sentStates.add(key)
		return {
			token,
			cache: cached.present
				? { status: `value`, value }
				: { status: `uncached` },
			revision: revisions.get(key) ?? 0,
			editable:
				control &&
				cached.present &&
				(type === `atom` || type.startsWith(`writable`)) &&
				isEditableValue(value) &&
				isEditableValue(cached.value),
		}
	}
	function historyUpdate<T extends RecordedEvent>(
		previous: readonly T[],
		next: readonly T[],
	): RemoteHistoryUpdate<T> {
		const start = Math.max(0, previous.indexOf(next[0]))
		let length = 0
		while (length < next.length && previous[start + length] === next[length])
			length++
		return { start, length, append: next.slice(length).map(copyEvent) }
	}
	function publishSnapshot() {
		const stateMaps = [
			store.atoms,
			store.readonlySelectors,
			store.writableSelectors,
		]
		const snapshot: RemoteStoreSnapshot = {
			control,
			states: [],
			timelines: [],
			transactions: [],
			ecology: ecology.initial,
		}
		for (const states of stateMaps)
			for (const definition of states.values())
				if (visible(definition.key)) snapshot.states.push(readState(definition))
		for (const [key, timeline] of store.timelines) {
			if (!visible(key)) continue
			const revision = ++timelineRevision
			timelineRevisions.set(key, revision)
			sentTimelines.set(key, timeline.history.slice())
			snapshot.timelines.push({
				token: deposit(timeline),
				at: timeline.at,
				revision,
				history: timeline.history.map(copyEvent),
			})
		}
		for (const [key, transaction] of store.transactions) {
			if (!visible(key)) continue
			snapshot.transactions.push({ token: deposit(transaction), history: [] })
		}
		transport.send({ type: `store`, version: REMOTE_PROTOCOL_VERSION, snapshot })
	}
	function publishUpdate() {
		if (closed) return
		const update: RemoteStoreUpdate = {
			states: [],
			removedStates: [],
			timelines: [],
			removedTimelines: [],
			transactions: [],
		}
		for (const key of changedStates) {
			if (!visible(key)) continue
			const definition = peekStateDefinition(store, key)
			if (definition) update.states.push(readState(definition))
			else if (sentStates.delete(key)) update.removedStates.push(key)
		}
		const graph = ecology.update({
			values: changedStates,
			states: changedDefinitions,
			families: changedFamilies,
			dependencies: changedDependencies,
		})
		if (graph) update.ecology = graph
		changedStates.clear()
		changedDefinitions.clear()
		changedFamilies.clear()
		changedDependencies.clear()
		for (const key of changedTimelines) {
			const timeline = store.timelines.get(key)
			if (!timeline) {
				timelineRevisions.delete(key)
				if (sentTimelines.delete(key)) update.removedTimelines.push(key)
				continue
			}
			update.timelines.push({
				token: deposit(timeline),
				at: timeline.at,
				revision: timelineRevisions.get(key)!,
				history: historyUpdate(sentTimelines.get(key) ?? [], timeline.history),
			})
			sentTimelines.set(key, timeline.history.slice())
		}
		changedTimelines.clear()
		for (const key of changedTransactions) {
			const entry = transactions.get(key)!
			update.transactions.push({
				token: deposit(store.transactions.get(key)!),
				history: historyUpdate(sentTransactions.get(key) ?? [], entry),
			})
			sentTransactions.set(key, entry.slice())
		}
		changedTransactions.clear()
		if (
			update.states.length ||
			update.removedStates.length ||
			update.timelines.length ||
			update.removedTimelines.length ||
			update.transactions.length ||
			update.ecology
		)
			transport.send({ type: `store-update`, sequence: ++sequence, update })
	}
	const schedule = batchDevtoolsUpdates(publishUpdate, dispose)
	function dispose(notify = true) {
		if (closed) return
		closed = true
		for (const stop of cleanup) stop()
		for (const { stop } of watches.values()) stop()
		closeDevtoolsTransport(transport, notify)
	}
	function receive(data: PanelMessage) {
		if (closed || !data) return
		if (data.type === `close`) {
			dispose(false)
			return
		}
		if (data.type === `state-requests`) {
			for (const request of data.generate)
				receive({ ...request, type: `generate` })
			for (const request of data.release)
				receive({ ...request, type: `release` })
			return
		}
		try {
			if (!control) throw new Error(`Remote devtools is inspection only`)
			if (!visible(data.key)) throw new Error(`Remote state is unavailable`)
			if (data.type === `release`) {
				const watch = watches.get(data.key)
				if (watch?.ids.delete(data.watch) && watch.ids.size === 0) {
					watch.stop()
					watches.delete(data.key)
				}
				return
			}
			if (data.type === `timeline`) {
				const timeline = store.timelines.get(data.key)
				if (
					!timeline ||
					data.revision === undefined ||
					timelineRevisions.get(data.key) !== data.revision
				)
					throw new Error(
						`Remote timeline changed. Try again with the current history.`,
					)
				if (data.action === `undo`) silo.undo(deposit(timeline))
				if (data.action === `redo`) silo.redo(deposit(timeline))
			} else {
				const definition = peekStateDefinition(store, data.key)
				if (!definition) throw new Error(`Remote state is unavailable`)
				const token: RemoteStateToken = deposit(definition)
				switch (data.type) {
					case `generate`:
						silo.getState(token)
						if (
							data.watch !== undefined &&
							definition.type.includes(`selector`)
						) {
							const watch = watches.get(token.key)
							if (watch) watch.ids.add(data.watch)
							else
								watches.set(token.key, {
									ids: new Set([data.watch]),
									// Keep the selector live while the store observer publishes cache writes.
									stop: subscribeToState(store, token, subscriber, () => {}),
								})
						}
						break
					case `dispose`:
						if (!token.family)
							throw new Error(`Only family members can be disposed`)
						disposeFromStore(store, token)
						break
					case `edit`: {
						if (data.revision !== (revisions.get(token.key) ?? 0))
							throw new Error(
								`Remote state changed while you were editing. Try again with the current value.`,
							)
						const current = peekState(store, token.key)
						if (
							(token.type !== `atom` && !token.type.startsWith(`writable`)) ||
							!current.present ||
							!isEditableValue(current.value) ||
							!isEditableValue(data.value)
						)
							throw new Error(`Remote store rejected this value`)
						silo.setState(
							token as WritableToken<unknown, any, any>,
							() => data.value,
						)
						break
					}
				}
			}
		} catch (error) {
			reportDevtoolsError(transport, error, dispose)
		}
	}
	try {
		cleanup.push(
			observeStore(store, (changes) => {
				const { states, values, families, dependencies, timelines } = changes
				for (const key of new Set([...states, ...values])) {
					revisions.set(key, (revisions.get(key) ?? 0) + 1)
					changedStates.add(key)
				}
				for (const key of states) {
					changedDefinitions.add(key)
					watches.get(key)?.stop()
					watches.delete(key)
				}
				for (const key of families) changedFamilies.add(key)
				for (const key of dependencies) changedDependencies.add(key)
				for (const key of timelines) {
					if (!visible(key)) continue
					timelineRevisions.set(key, ++timelineRevision)
					changedTimelines.add(key)
				}
				for (const [key, { registeredAt, outcomes }] of changes.transactions) {
					if (!visible(key)) continue
					const previous =
						registeredAt === undefined ? (transactions.get(key) ?? []) : []
					const history = previous
						.concat(outcomes.slice(registeredAt))
						.slice(-200)
					transactions.set(key, history)
					changedTransactions.add(key)
				}
				schedule()
			}),
		)
		transport.listen(receive, dispose)
		publishSnapshot()
	} catch (error) {
		dispose(false)
		throw error
	}
	return dispose
}
