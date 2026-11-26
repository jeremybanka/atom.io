import type { AtomToken, TimelineEvent, TransactionSubEvent } from "atom.io"
import { getTimelineTransactionGroup } from "atom.io/internal"

export type RecordedEvent = (
	| TransactionSubEvent
	| TimelineEvent<AtomToken<unknown>>
) & {
	/** The same occurrence on the transaction log and on its timeline copies. */
	timelineOutcomeSequence?: number
}

export function historyOutcomeSequence(
	event: RecordedEvent,
): number | undefined {
	if (event.type === `transaction_outcome`)
		return (
			event.timelineOutcomeSequence ??
			getTimelineTransactionGroup(event)?.sequence
		)
}

export function appendTransactionHistory<Event>(
	previous: readonly Event[],
	outcomes: readonly Event[],
	registeredAt: number | undefined,
): Event[] {
	return (registeredAt === undefined ? previous : [])
		.concat(outcomes.slice(registeredAt))
		.slice(-200)
}
const identities = new WeakMap<object, string>()
let identity = 0
/** Identity survives appends and cannot accidentally select an event after history is culled. */
export function historyIdentity(record: object): string {
	let id = identities.get(record)
	if (!id) identities.set(record, (id = `history-${identity++}`))
	return id
}
export function timelineEventTitle(event: RecordedEvent, index: number): string {
	const name = `token` in event ? event.token.key : timelineEventKind(event)
	return `${index + 1} · ${name}`
}

const timelineKinds: Partial<Record<RecordedEvent[`type`], string>> = {
	atom_update: `Atom update`,
	atom_creation: `Created`,
	atom_disposal: `Disposed`,
	selector_update: `Selector update`,
	transaction_outcome: `Transaction`,
}

export function timelineEventKind(event: RecordedEvent): string {
	return timelineKinds[event.type] ?? event.type.replaceAll(`_`, ` `)
}

export function timelinePosition(at: number, length: number): string {
	return `${at} of ${length} ${length === 1 ? `event` : `events`} applied`
}

export function compactOutcomePath(eventId: string): readonly string[] {
	return [`ecology-outcome`, eventId]
}

export function historyGraphId(owner: string, eventId: string): string {
	return `history:${owner}:${eventId}`
}
/** Do not enumerate, coerce or serialize application-owned values, including proxies. */
export function historyValue(value: unknown, limit = 1024): string | undefined {
	if (typeof value === `string`)
		return (
			JSON.stringify(value.slice(0, limit)) + (value.length > limit ? `…` : ``)
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
export function historyParams(
	params: readonly unknown[],
	full = false,
	format: (value: unknown) => string | undefined = historyValue,
): string {
	const values = params.slice(0, full ? 64 : 16)
	return `[${values.map((value) => format(value) ?? `[opaque]`).join(`,`)}${values.length < params.length ? `,…` : ``}]`
}

export function historyWriteCount(events: readonly RecordedEvent[]): number {
	const pending = [...events]
	const visited = new Set<RecordedEvent>()
	let count = 0
	while (pending.length) {
		const event = pending.pop()!
		if (`update` in event) count++
		else if (`subEvents` in event && !visited.has(event)) {
			visited.add(event)
			for (const child of event.subEvents) pending.push(child)
		}
	}
	return count
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
