import type { AtomToken, TimelineEvent, TransactionSubEvent } from "atom.io"

export type RecordedEvent =
	| TransactionSubEvent
	| TimelineEvent<AtomToken<unknown>>

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
