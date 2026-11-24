import type {
	Silo,
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
import { observeStore, peekState } from "atom.io/introspection"

import { captureEcologySnapshot } from "./ecology.ts"
import type { RecordedEvent } from "./history-event.ts"
import {
	batchDevtoolsSnapshots,
	closeDevtoolsTransport,
	type DevtoolsStoreTransport,
	reportDevtoolsError,
} from "./transport.ts"
import type {
	PanelMessage,
	WorkerHistory,
	WorkerStateToken,
	WorkerStoreSnapshot,
} from "./worker-protocol.ts"

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
	const cleanup: (() => void)[] = []
	const timelines = new Map<string, { revision: number; stop(): void }>()
	const transactions = new Map<
		string,
		{
			owner: object
			stop(): void
			history: TransactionOutcomeEvent<TransactionToken<any>>[]
		}
	>()
	const eventCopies = new WeakMap<RecordedEvent, WorkerHistory>()
	let eventId = 0
	let timelineRevision = 0
	let closed = false
	const subscriber = arbitrary()
	const state = (key: string) =>
		store.atoms.get(key) ??
		store.readonlySelectors.get(key) ??
		store.writableSelectors.get(key)
	function eventRecord<T extends RecordedEvent>(event: T): WorkerHistory<T> {
		let record = eventCopies.get(event)
		if (!record) {
			record = { id: String(eventId++), event: copyEvent(event) }
			eventCopies.set(event, record)
		}
		return record as WorkerHistory<T>
	}
	function addTransaction(key: string) {
		const transaction = store.transactions.get(key)
		if (!transaction || !visible(key)) return
		const current = transactions.get(key)
		if (current?.owner === transaction) return current
		current?.stop()
		const history: TransactionOutcomeEvent<TransactionToken<any>>[] = []
		const stop = transaction.subject.subscribe(subscriber, (event) => {
			if (event.token.key !== key) return
			if (history.length === 200) history.shift()
			history.push(event)
			schedule()
		})
		const entry = { owner: transaction, stop, history }
		transactions.set(key, entry)
		return entry
	}
	function publish() {
		if (closed) return
		const snapshot: WorkerStoreSnapshot = {
			control,
			states: [],
			timelines: [],
			transactions: [],
			ecology: captureEcologySnapshot(store, {
				maxNodes: 10_000,
				maxFamilies: 10_000,
				maxRelations: 50_000,
			}),
		}
		for (const states of [
			store.atoms,
			store.readonlySelectors,
			store.writableSelectors,
		]) {
			for (const definition of states.values()) {
				const { key, type } = definition
				if (!visible(key)) continue
				const token: WorkerStateToken = deposit(definition)
				const cached = peekState(store, key)
				const value =
					cached.value instanceof Future
						? new Error(`Remote value is pending`)
						: copyValue(cached.value)
				snapshot.states.push({
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
				})
			}
		}
		for (const [key, timeline] of store.timelines)
			if (visible(key))
				snapshot.timelines.push({
					token: deposit(timeline),
					at: timeline.at,
					revision: timelines.get(key)!.revision,
					history: timeline.history.map(eventRecord),
				})
		for (const [key, transaction] of store.transactions) {
			const entry = addTransaction(key)
			if (entry)
				snapshot.transactions.push({
					token: deposit(transaction),
					history: entry.history.map(eventRecord),
				})
		}
		transport.send({ type: `store`, snapshot })
	}
	const schedule = batchDevtoolsSnapshots(publish, dispose)
	const addTimeline = (key: string) => {
		const timeline = store.timelines.get(key)
		if (!timeline || !visible(key)) return
		timelines.get(key)?.stop()
		const entry = {
			revision: ++timelineRevision,
			stop: timeline.subject.subscribe(subscriber, () => {
				entry.revision = ++timelineRevision
				schedule()
			}),
		}
		timelines.set(key, entry)
	}
	function dispose(notify = true) {
		if (closed) return
		closed = true
		for (const stop of cleanup) stop()
		for (const { stop } of timelines.values()) stop()
		for (const { stop } of transactions.values()) stop()
		for (const { stop } of watches.values()) stop()
		closeDevtoolsTransport(transport, notify)
	}
	function receive(data: PanelMessage) {
		if (closed || !data) return
		if (data.type === `close`) {
			dispose(false)
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
				if (!timeline || timelines.get(data.key)?.revision !== data.revision)
					throw new Error(
						`Remote timeline changed. Try again with the current history.`,
					)
				if (data.action === `undo`) silo.undo(deposit(timeline))
				if (data.action === `redo`) silo.redo(deposit(timeline))
			} else {
				const definition = state(data.key)
				if (!definition) throw new Error(`Remote state is unavailable`)
				const token: WorkerStateToken = deposit(definition)
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
									stop: subscribeToState(store, token, subscriber, schedule),
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
		schedule()
	}
	try {
		for (const key of store.timelines.keys()) addTimeline(key)
		cleanup.push(
			observeStore(store, ({ states, values }) => {
				for (const key of new Set([...states, ...values]))
					revisions.set(key, (revisions.get(key) ?? 0) + 1)
				for (const key of states) {
					watches.get(key)?.stop()
					watches.delete(key)
				}
				schedule()
			}),
			store.on.timelineCreation.subscribe(subscriber, ({ key }) => {
				addTimeline(key)
				schedule()
			}),
			store.on.timelineDisposal.subscribe(subscriber, ({ key }) => {
				timelines.get(key)?.stop()
				timelines.delete(key)
				schedule()
			}),
			store.on.transactionCreation.subscribe(subscriber, ({ key }) => {
				addTransaction(key)
				schedule()
			}),
			store.on.transactionApplying.subscribe(subscriber, (progress) => {
				// Same-key replacement skips creation. Subscribe before the outcome is emitted.
				if (progress) addTransaction(progress.update.token.key)
			}),
		)
		transport.listen(receive, dispose)
		publish()
	} catch (error) {
		dispose(false)
		throw error
	}
	return dispose
}
