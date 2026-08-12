import type { Clock } from "atom.io/realtime"

export type VirtualClockTask = {
	readonly dueAt: number
	readonly id: number
	readonly label: string | undefined
}

export type VirtualClockOptions = {
	/** Guards tests from accidentally scheduling work forever. */
	readonly maxTasksPerRun?: number
	readonly startAt?: number
}

type InternalTask = VirtualClockTask & {
	readonly callback: () => void
	readonly sequence: number
}

/**
 * A synchronous, harness-owned clock for realtime protocol tests.
 *
 * Callbacks scheduled for the same instant execute in insertion order. Callbacks
 * may schedule more callbacks, including callbacks for the current instant.
 */
export class VirtualClock implements Clock {
	readonly #defaultMaxTasks: number
	#nextId = 1
	#sequence = 0
	#tasks = new Map<number, InternalTask>()
	#time: number

	public constructor(options: VirtualClockOptions = {}) {
		this.#time = options.startAt ?? 0
		this.#defaultMaxTasks = options.maxTasksPerRun ?? 10_000
		if (!Number.isFinite(this.#time)) {
			throw new Error(`VirtualClock startAt must be finite`)
		}
	}

	/** The current virtual timestamp. */
	public now(): number {
		return this.#time
	}

	/** Schedule synchronous work after a non-negative virtual delay. */
	public schedule(callback: () => void, delay = 0, label?: string): number {
		if (!Number.isFinite(delay) || delay < 0) {
			throw new Error(`VirtualClock delay must be finite and non-negative`)
		}
		const id = this.#nextId++
		this.#tasks.set(id, {
			callback,
			dueAt: this.#time + delay,
			id,
			label,
			sequence: this.#sequence++,
		})
		return id
	}

	/** Cancel pending work. Returns whether the task was still pending. */
	public cancel(id: number): boolean {
		return this.#tasks.delete(id)
	}

	/** Return pending tasks ordered exactly as the clock will run them. */
	public pending(): readonly VirtualClockTask[] {
		return this.#orderedTasks().map(({ dueAt, id, label }) => ({
			dueAt,
			id,
			label,
		}))
	}

	/** Advance by a duration, running every task due within the interval. */
	public advance(
		duration: number,
		maxTasks: number = this.#defaultMaxTasks,
	): number {
		if (!Number.isFinite(duration) || duration < 0) {
			throw new Error(
				`VirtualClock advance duration must be finite and non-negative`,
			)
		}
		return this.#runThrough(this.#time + duration, maxTasks)
	}

	/** Advance to an absolute virtual timestamp. */
	public advanceTo(
		timestamp: number,
		maxTasks: number = this.#defaultMaxTasks,
	): number {
		if (!Number.isFinite(timestamp) || timestamp < this.#time) {
			throw new Error(
				`VirtualClock cannot move backwards from ${this.#time} to ${timestamp}`,
			)
		}
		return this.#runThrough(timestamp, maxTasks)
	}

	/**
	 * Jump through every scheduled timestamp until no work remains.
	 *
	 * Throws with pending-task diagnostics when the safety limit is exceeded.
	 */
	public runUntilIdle(maxTasks: number = this.#defaultMaxTasks): number {
		let ran = 0
		while (this.#tasks.size > 0) {
			const next = this.#orderedTasks()[0]
			if (next === undefined) break
			ran += this.#runThrough(next.dueAt, maxTasks - ran)
			if (ran >= maxTasks && this.#tasks.size > 0) {
				throw this.#limitError(maxTasks)
			}
		}
		return ran
	}

	#runThrough(timestamp: number, maxTasks: number): number {
		let ran = 0
		while (true) {
			const next = this.#orderedTasks()[0]
			if (next === undefined || next.dueAt > timestamp) break
			if (ran >= maxTasks) throw this.#limitError(maxTasks)
			this.#time = next.dueAt
			this.#tasks.delete(next.id)
			next.callback()
			ran++
		}
		// A callback may advance this clock reentrantly; never move it backwards
		// when the outer advance resumes.
		this.#time = Math.max(this.#time, timestamp)
		return ran
	}

	#orderedTasks(): InternalTask[] {
		return [...this.#tasks.values()].sort(
			(left, right) =>
				left.dueAt - right.dueAt || left.sequence - right.sequence,
		)
	}

	#limitError(maxTasks: number): Error {
		return new Error(
			`VirtualClock exceeded its ${maxTasks}-task safety limit; pending: ${JSON.stringify(this.pending())}`,
		)
	}
}
