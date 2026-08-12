export interface Clock {
	/** Cancel scheduled work. Returns whether it was still pending. */
	cancel(task: number): boolean
	/** Return the clock's current timestamp. */
	now(): number
	/** Schedule work after a non-negative delay. */
	schedule(callback: () => void, delay?: number, label?: string): number
}

/**
 * A wall-clock scheduler used by realtime APIs unless a test clock is injected.
 *
 * Keeping the small Clock interface in realtime core lets future leases, retry
 * backoff, and expiry policies use the same deterministic test seam.
 */
export class SystemClock implements Clock {
	#nextTask = 1
	#tasks = new Map<number, ReturnType<typeof setTimeout>>()

	public now(): number {
		return Date.now()
	}

	public schedule(callback: () => void, delay = 0, _label?: string): number {
		if (!Number.isFinite(delay) || delay < 0) {
			throw new Error(`SystemClock delay must be finite and non-negative`)
		}
		const task = this.#nextTask++
		const timeout = setTimeout(() => {
			this.#tasks.delete(task)
			callback()
		}, delay)
		this.#tasks.set(task, timeout)
		return task
	}

	public cancel(task: number): boolean {
		const timeout = this.#tasks.get(task)
		if (timeout === undefined) return false
		clearTimeout(timeout)
		this.#tasks.delete(task)
		return true
	}
}

export const systemClock: Clock = new SystemClock()
