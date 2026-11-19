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
import type { RecordedEvent } from "./history-search.ts"
import type {
	PanelMessage,
	WorkerHistory,
	WorkerMessage,
	WorkerStateToken,
	WorkerStoreSnapshot,
} from "./worker-protocol.ts"

export function isEditableValue(value: unknown): boolean {
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
			!Array.isArray(next) &&
			prototype !== null &&
			Object.getPrototypeOf(prototype) !== null
		)
			return false
		seen.add(next)
		for (const member of Object.values(next)) pending.push(member)
	}
	return true
}

function copyValue(value: unknown): unknown {
	try {
		return structuredClone(value)
	} catch {
		return new Error(`Value could not be transferred from the worker`)
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
export function exposeWholeStore(port: MessagePort, silo: Silo): () => void {
	const { store } = silo
	const watch = new Map<string, () => void>()
	const revisions = new Map<string, number>()
	const cleanup: (() => void)[] = []
	const timelines = new Map<string, () => void>()
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
	let closed = false
	let scheduled = false
	const subscriber = arbitrary()
	const state = (key: string) =>
		store.atoms.get(key) ??
		store.readonlySelectors.get(key) ??
		store.writableSelectors.get(key)
	const send = (message: WorkerMessage) => {
		port.postMessage(message)
	}
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
						? new Error(`Worker value is pending`)
						: copyValue(cached.value)
				snapshot.states.push({
					token,
					cache: cached.present
						? { status: `value`, value }
						: { status: `uncached` },
					revision: revisions.get(key) ?? 0,
					editable:
						cached.present &&
						(type === `atom` || type.startsWith(`writable`)) &&
						isEditableValue(value),
				})
			}
		}
		for (const [key, timeline] of store.timelines)
			if (visible(key))
				snapshot.timelines.push({
					token: deposit(timeline),
					at: timeline.at,
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
		send({ type: `store`, snapshot })
	}
	function schedule() {
		if (closed || scheduled) return
		scheduled = true
		queueMicrotask(() => {
			scheduled = false
			publish()
		})
	}
	const addTimeline = (key: string) => {
		const timeline = store.timelines.get(key)
		if (!timeline || !visible(key)) return
		timelines.get(key)?.()
		timelines.set(key, timeline.subject.subscribe(subscriber, schedule))
	}
	function dispose() {
		if (closed) return
		closed = true
		port.removeEventListener(`message`, receive)
		port.removeEventListener(`messageerror`, dispose)
		for (const stop of cleanup) stop()
		for (const stop of timelines.values()) stop()
		for (const { stop } of transactions.values()) stop()
		for (const stop of watch.values()) stop()
		send({ type: `close` })
		port.close()
	}
	function receive({ data }: MessageEvent<PanelMessage>) {
		if (!data) return
		if (data.type === `close`) {
			dispose()
			return
		}
		try {
			if (!visible(data.key)) throw new Error(`Worker state is unavailable`)
			if (data.type === `timeline`) {
				const timeline = store.timelines.get(data.key)
				if (
					!timeline ||
					timeline.at !== data.at ||
					timeline.history.length !== data.length
				)
					throw new Error(
						`Worker timeline changed. Try again with the current history.`,
					)
				if (data.action === `undo`) silo.undo(deposit(timeline))
				if (data.action === `redo`) silo.redo(deposit(timeline))
			} else {
				const definition = state(data.key)
				if (!definition) throw new Error(`Worker state is unavailable`)
				const token: WorkerStateToken = deposit(definition)
				switch (data.type) {
					case `generate`:
						silo.getState(token)
						if (definition.type.includes(`selector`) && !watch.has(token.key)) {
							watch.set(
								token.key,
								subscribeToState(store, token, subscriber, schedule),
							)
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
								`Worker state changed while you were editing. Try again with the current value.`,
							)
						const current = peekState(store, token.key)
						if (
							(token.type !== `atom` && !token.type.startsWith(`writable`)) ||
							!current.present ||
							!isEditableValue(current.value) ||
							!isEditableValue(data.value)
						)
							throw new Error(`Worker rejected this value`)
						silo.setState(
							token as WritableToken<unknown, any, any>,
							() => data.value,
						)
						break
					}
				}
			}
		} catch (error) {
			send({
				type: `edit-error`,
				message: error instanceof Error ? error.message : String(error),
			})
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
					watch.get(key)?.()
					watch.delete(key)
				}
				schedule()
			}),
			store.on.timelineCreation.subscribe(subscriber, ({ key }) => {
				addTimeline(key)
				schedule()
			}),
			store.on.timelineDisposal.subscribe(subscriber, ({ key }) => {
				timelines.get(key)?.()
				timelines.delete(key)
				schedule()
			}),
			store.on.transactionCreation.subscribe(subscriber, ({ key }) => {
				addTransaction(key)
				schedule()
			}),
		)
		port.addEventListener(`message`, receive)
		port.addEventListener(`messageerror`, dispose)
		port.start()
		publish()
	} catch (error) {
		dispose()
		throw error
	}
	return dispose
}
