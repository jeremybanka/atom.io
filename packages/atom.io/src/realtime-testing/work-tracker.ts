/** Context supplied to application-work drain adapters. */
export type RealtimeTestDrainContext = {
	/** Aborted when the enclosing wait completes or times out. */
	signal: AbortSignal
	/** Absolute wall-clock deadline for this drain attempt. */
	deadline: number
	/** Injectable time seam for a future virtual-clock implementation. */
	now: () => number
}

/**
 * An application-owned drain seam. Use it for queues that cannot be represented
 * by one Promise, such as an actor mailbox or framework scheduler.
 */
export type RealtimeTestWorkDrain = (
	context: RealtimeTestDrainContext,
) => Promise<void> | void

type PendingWork = {
	label: string
	promise: Promise<unknown>
}

/**
 * Tracks application work separately from transport delivery.
 *
 * Promise work can be registered with {@link track}; queue-like systems can
 * register a drain adapter with {@link registerDrain}. Draining repeats until no
 * adapter call or tracked Promise creates more work.
 */
export class RealtimeTestWorkTracker {
	readonly #drains = new Set<RealtimeTestWorkDrain>()
	readonly #pending = new Map<number, PendingWork>()
	#nextId = 0
	#revision = 0

	/** Track a Promise and return the original Promise for convenient composition. */
	track<T>(work: PromiseLike<T>, label = `application work`): Promise<T> {
		const id = ++this.#nextId
		const promise = Promise.resolve(work)
		this.#pending.set(id, { label, promise })
		this.#revision++
		void promise.then(
			() => {
				this.#pending.delete(id)
				this.#revision++
			},
			() => {
				this.#pending.delete(id)
				this.#revision++
			},
		)
		return promise
	}

	/** Register a queue/scheduler drain adapter and return its disposer. */
	registerDrain(drain: RealtimeTestWorkDrain): () => void {
		this.#drains.add(drain)
		this.#revision++
		return () => {
			if (this.#drains.delete(drain)) this.#revision++
		}
	}

	/** Labels for work still pending, suitable for timeout diagnostics. */
	pendingLabels(): readonly string[] {
		return [...this.#pending.values()].map(({ label }) => label)
	}

	/** @internal Drain adapters and tracked Promises until the tracker is stable. */
	async drain(context: RealtimeTestDrainContext): Promise<void> {
		for (;;) {
			if (context.signal.aborted) throw context.signal.reason
			const before = this.#revision
			for (const drain of this.#drains) await drain(context)
			await Promise.all(
				[...this.#pending.values()].map(({ promise }) => promise),
			)
			if (before === this.#revision && this.#pending.size === 0) return
		}
	}
}
