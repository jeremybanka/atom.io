import type { UserKey } from "atom.io/realtime"

/** A cursor points immediately after the journal entries observed so far. */
export type RealtimeTestEventCursor = number

/** The transport boundary at which a realtime test event was observed. */
export type RealtimeTestEventDirection =
	| `client:incoming`
	| `client:outgoing`
	| `server:incoming`
	| `server:outgoing`

/** One occurrence in a realtime test scenario's ordered transport journal. */
export type RealtimeTestEvent = {
	/** A monotonically increasing, scenario-local sequence number. */
	sequence: number
	/** The wall-clock timestamp. A future virtual clock may supply this value. */
	timestamp: number
	direction: RealtimeTestEventDirection
	event: string
	args: readonly unknown[]
	userKey: UserKey
	sessionId: string
	source: string
	destination: string
}

/** Select occurrences from a realtime test event journal. */
export type RealtimeTestEventFilter = {
	/** Only match entries recorded at or after this cursor. */
	after?: RealtimeTestEventCursor
	direction?: RealtimeTestEventDirection
	event?: string
	userKey?: UserKey
	sessionId?: string
	predicate?: (entry: RealtimeTestEvent) => boolean
}

export type WaitForRealtimeTestEventOptions = {
	/** Maximum wall-clock wait. Defaults to 1,000 milliseconds. */
	timeout?: number
}

type Waiter = {
	filter: RealtimeTestEventFilter
	reject: (error: Error) => void
	resolve: (entry: RealtimeTestEvent) => void
	timer: ReturnType<typeof setTimeout>
}

const matches = (
	entry: RealtimeTestEvent,
	filter: RealtimeTestEventFilter,
): boolean =>
	entry.sequence >= (filter.after ?? 0) &&
	(filter.direction === undefined || entry.direction === filter.direction) &&
	(filter.event === undefined || entry.event === filter.event) &&
	(filter.userKey === undefined || entry.userKey === filter.userKey) &&
	(filter.sessionId === undefined || entry.sessionId === filter.sessionId) &&
	(filter.predicate === undefined || filter.predicate(entry))

const stringify = (value: unknown): string => {
	try {
		const serialized = JSON.stringify(value)
		return serialized === undefined ? String(value) : serialized
	} catch {
		return `[unserializable]`
	}
}

/**
 * An occurrence-aware, append-only journal shared by all actors in one test.
 *
 * Cursors make assertions unambiguous when an event name is emitted repeatedly:
 * capture {@link cursor} before an action, then pass it as `after`.
 */
export class RealtimeTestEventJournal {
	readonly #entries: RealtimeTestEvent[] = []
	readonly #waiters = new Set<Waiter>()
	readonly #diagnostics: (() => string) | undefined

	constructor(options: { diagnostics?: () => string } = {}) {
		this.#diagnostics = options.diagnostics
	}

	/** Return a cursor that excludes all entries currently in the journal. */
	cursor(): RealtimeTestEventCursor {
		return this.#entries.length
	}

	/** Return a stable snapshot of matching entries in occurrence order. */
	entries(filter: RealtimeTestEventFilter = {}): readonly RealtimeTestEvent[] {
		return this.#entries.filter((entry) => matches(entry, filter))
	}

	/** Count matching occurrences, rather than merely checking event-name presence. */
	count(filter: RealtimeTestEventFilter = {}): number {
		return this.entries(filter).length
	}

	/**
	 * Wait for the first matching occurrence, including one already in the journal.
	 * Timeout errors include a compact transcript for diagnosis.
	 */
	waitForEvent(
		filter: RealtimeTestEventFilter,
		options: WaitForRealtimeTestEventOptions = {},
	): Promise<RealtimeTestEvent> {
		const existing = this.#entries.find((entry) => matches(entry, filter))
		if (existing) return Promise.resolve(existing)

		const timeout = options.timeout ?? 1_000
		return new Promise((resolve, reject) => {
			const waiter: Waiter = {
				filter,
				reject,
				resolve,
				timer: setTimeout(() => {
					this.#waiters.delete(waiter)
					reject(
						new Error(
							`Timed out after ${timeout}ms waiting for realtime event ${stringify(filter)}.${this.#diagnostics ? `\n\nSelected state:\n${this.#diagnostics()}` : ``}\n\nEvent journal:\n${this.transcript({ limit: 20 })}`,
						),
					)
				}, timeout),
			}
			this.#waiters.add(waiter)
		})
	}

	/** Format the newest matching entries as a compact diagnostic transcript. */
	transcript(
		options: RealtimeTestEventFilter & { limit?: number } = {},
	): string {
		const { limit = 20, ...filter } = options
		const selected = this.entries(filter).slice(-limit)
		if (selected.length === 0) return `[realtime journal is empty]`
		return selected
			.map(
				(entry) =>
					`#${entry.sequence} ${entry.direction} ${entry.source} -> ${entry.destination} ${entry.event}${entry.args.length === 0 ? `` : ` ${entry.args.map(stringify).join(` `)}`}`,
			)
			.join(`\n`)
	}

	/** @internal Record a transport observation. */
	record(
		entry: Omit<RealtimeTestEvent, `sequence` | `timestamp`>,
	): RealtimeTestEvent {
		const recorded: RealtimeTestEvent = {
			...entry,
			sequence: this.#entries.length,
			timestamp: Date.now(),
		}
		this.#entries.push(recorded)
		for (const waiter of this.#waiters) {
			if (!matches(recorded, waiter.filter)) continue
			clearTimeout(waiter.timer)
			this.#waiters.delete(waiter)
			waiter.resolve(recorded)
		}
		return recorded
	}

	/** @internal Reject pending waits when their scenario is torn down. */
	dispose(): void {
		for (const waiter of this.#waiters) {
			clearTimeout(waiter.timer)
			waiter.reject(new Error(`Realtime test scenario was disposed`))
		}
		this.#waiters.clear()
	}
}
