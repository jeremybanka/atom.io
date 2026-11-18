import type { AtomToken, TimelineEvent, TransactionSubEvent } from "atom.io"
import { isReservedIntrospectionKey, type RootStore } from "atom.io/internal"

import {
	addSearchDocument,
	type RawField,
	type SearchCapture,
	type SearchDocument,
} from "./search.ts"

export type HistoryView = `transactions` | `timelines`
export type RecordedEvent =
	| TransactionSubEvent
	| TimelineEvent<AtomToken<unknown>>
export type HistoryTarget = NonNullable<SearchDocument[`target`]>
const identities = new WeakMap<object, string>()
let identity = 0
/** Identity survives appends and cannot accidentally select an event after history is culled. */
export function historyIdentity(record: object): string {
	let id = identities.get(record)
	if (!id) identities.set(record, (id = `history-${identity++}`))
	return id
}
/** Do not enumerate, coerce or serialize application-owned values, including proxies. */
export function historyValue(value: unknown): string | undefined {
	if (typeof value === `string`)
		return (
			JSON.stringify(value.slice(0, 1024)) + (value.length > 1024 ? `…` : ``)
		)
	if (
		value === null ||
		value === undefined ||
		typeof value === `number` ||
		typeof value === `boolean`
	)
		return String(value)
	return undefined
}
export function historyParams(params: readonly unknown[]): string {
	return `[${params
		.slice(0, 16)
		.map((value) => historyValue(value) ?? `[opaque]`)
		.join(`,`)}${params.length > 16 ? `,…` : ``}]`
}
function owners(store: RootStore, view: HistoryView) {
	return view === `transactions` ? store.transactions : store.timelines
}
function recorded(
	store: RootStore,
	view: HistoryView,
	key: string,
): readonly RecordedEvent[] | undefined {
	if (view === `timelines`) return store.timelines.get(key)!.history
	// This is the backing cache of attachTransactionLogs, not its lazy selector.
	// Reading it neither creates a log member nor installs a recording subscription.
	return store.valueMap.get(
		`🔍 Transaction Update Log (Internal)(${JSON.stringify(key)})`,
	) as readonly RecordedEvent[] | undefined
}
function children(event: RecordedEvent): readonly RecordedEvent[] {
	return `subEvents` in event ? event.subEvents : []
}
/** Verify the entire captured path against committed history before expanding any UI. */
export function historyTargetExists(
	store: RootStore,
	view: HistoryView,
	target: HistoryTarget,
): boolean {
	let inspected = 0
	for (const [key, owner] of owners(store, view)) {
		if (++inspected > 200) break
		if (historyIdentity(owner) !== target.owner) continue
		if (!target.path.length) return true
		let events = recorded(store, view, key)
		for (let i = 0; i < target.path.length; i++) {
			const event = events?.[target.path[i]]
			if (!event || historyIdentity(event) !== target.chain[i]) return false
			events = children(event)
		}
		return true
	}
	return false
}

/** Bounded committed-root copy of core-owned event records; payload objects are opaque. */
export function captureHistorySearch(
	store: RootStore,
	view: HistoryView,
): SearchCapture | null {
	if (store.on.transactionApplying.state !== null) return null
	const work = { nodes: 0, families: 0, relations: 0 }
	const result: SearchCapture = {
		documents: [],
		capturedAt: Date.now(),
		partial: false,
		truncatedText: 0,
		skippedValues: 0,
		uncachedValues: 0,
		characters: 0,
		snapshotWork: work,
	}
	let missing = 0
	const available = () =>
		result.documents.length < 5000 &&
		result.characters < 500_000 &&
		result.snapshotWork.relations < 10_000
	for (const [key, owner] of owners(store, view)) {
		if (result.snapshotWork.nodes === 200 || !available()) {
			result.partial = true
			break
		}
		work.nodes++
		if (isReservedIntrospectionKey(key) || key.startsWith(`👁‍🗨`)) continue
		const ownerId = historyIdentity(owner)
		const fields: RawField[] = [{ kind: `key`, text: key }]
		if (`family` in owner)
			fields.push(
				{ kind: `family`, text: owner.family.key },
				{ kind: `key`, text: owner.family.subKey },
			)
		// Bound serialization of the transaction's canonical string subkey as well.
		const events = key.length <= 1024 ? recorded(store, view, key) : undefined
		if (key.length > 1024) result.partial = true
		if (!events) missing++
		const cursor =
			view === `timelines` ? store.timelines.get(key)!.at : undefined
		const detail = `${key.slice(0, 128)} · ${events ? `${events.length} retained events` : `recording not started; no history captured`}${cursor === undefined ? `` : ` · cursor ${cursor}`}`
		addSearchDocument(
			result,
			{
				id: ownerId,
				key: key.slice(0, 1024),
				family: null,
				kind: view === `transactions` ? `transaction` : `timeline`,
				detail,
				value: `uncached`,
				target: { owner: ownerId, path: [], chain: [] },
			},
			fields,
		)
		if (!events) continue
		// Iterative depth-first traversal uses cursors instead of copying or reversing unbounded arrays.
		const stack = [
			{ events, at: 0, path: [] as number[], chain: [] as string[] },
		]
		const seen = new WeakSet<object>()
		while (stack.length) {
			const frame = stack[stack.length - 1]
			if (frame.at === frame.events.length) {
				stack.pop()
				continue
			}
			if (!available()) {
				result.partial = true
				break
			}
			const at = frame.at++,
				event = frame.events[at]
			work.relations++
			if (seen.has(event)) {
				result.partial = true
				continue
			}
			seen.add(event)
			const eventKey =
				`token` in event
					? event.token.key
					: typeof event.key === `string`
						? event.key
						: event.type
			const path = [...frame.path, at],
				chain = [...frame.chain, historyIdentity(event)]
			const eventFields: RawField[] = [
				{ kind: `key`, text: eventKey },
				{ kind: `family`, text: key },
				{ kind: `metadata`, text: event.type },
			]
			if (`token` in event && `family` in event.token && event.token.family)
				eventFields.push(
					{ kind: `family`, text: event.token.family.key },
					{ kind: `key`, text: event.token.family.subKey },
				)
			const copy = (value: unknown) => {
				const text = historyValue(value)
				if (text === undefined) result.skippedValues++
				else {
					eventFields.push({ kind: `value`, text })
					if (typeof value === `string` && value.length > 1024)
						result.partial = true
				}
			}
			if (`params` in event) {
				for (let i = 0; i < Math.min(16, event.params.length); i++)
					copy(event.params[i])
				if (event.params.length > 16) result.partial = true
				copy(event.output)
			} else if (`update` in event) {
				copy(event.update.oldValue)
				copy(event.update.newValue)
			} else if (`value` in event) copy(event.value)
			addSearchDocument(
				result,
				{
					id: `${ownerId}:${chain[chain.length - 1]}`,
					key: eventKey.slice(0, 1024),
					family: null,
					kind: `event`,
					detail: `${key.slice(0, 128)} · event ${path.map((i) => i + 1).join(`.`)} · ${event.type} · ${event.timestamp}${cursor === undefined ? `` : ` · captured cursor ${cursor}`}`,
					value: `copied`,
					target: { owner: ownerId, path, chain },
				},
				eventFields,
			)
			const nested = children(event)
			if (nested.length) {
				if (stack.length === 32) result.partial = true
				else stack.push({ events: nested, at: 0, path, chain })
			}
		}
	}
	result.notice = `${result.snapshotWork.nodes} log records inspected · ${result.snapshotWork.relations} events inspected · ${missing} logs without captured history. Transactions include only outcomes recorded since their log was opened; timelines include retained history only. Refresh to recapture. Opaque payloads are skipped; no actions replayed.`
	return result
}

/** Only core-owned event records are enumerated; application payloads stay opaque. */
export function historyEventPreview(event: RecordedEvent): string {
	return JSON.stringify(
		Object.fromEntries(
			Object.entries(event).map(([key, value]) => [
				key,
				historyValue(value) === undefined
					? `[opaque]`
					: typeof value === `string`
						? value.slice(0, 1024)
						: value,
			]),
		),
	)
}
