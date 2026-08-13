import type { Clock, Socket } from "atom.io/realtime"
import { systemClock } from "atom.io/realtime"

type SubData = {
	clock: Clock
	close: () => void
	coalesceMs: number
	completion: Promise<void> | null
	completionResolve: (() => void) | null
	refcount: number
	sessionId: string | undefined
	stopWatchingForReconnect: () => void
	task: number | null
}

export const SUBSCRIPTION_COALESCE_MS = 50

export type SubscriberOptions = {
	/** Injectable for deterministic coalescing tests. Defaults to wall time. */
	readonly clock?: Clock
	readonly coalesceMs?: number
}

const subscriptions: WeakMap<Socket, Map<string, SubData>> = new WeakMap()

export function getSubMap(socket: Socket): Map<string, SubData> {
	let subMap = subscriptions.get(socket)
	if (subMap === undefined) {
		subMap = new Map()
		subscriptions.set(socket, subMap)
	}
	return subMap
}

export function createSubscriber<K extends string>(
	socket: Socket,
	key: K,
	open: (key: K) => () => void,
	options: SubscriberOptions = {},
): () => void {
	const clock = options.clock ?? systemClock
	const coalesceMs = options.coalesceMs ?? SUBSCRIPTION_COALESCE_MS
	const subMap = getSubMap(socket)
	let sub = subMap.get(key)

	if (sub) {
		if (sub.clock !== clock || sub.coalesceMs !== coalesceMs) {
			throw new Error(
				`Subscriber "${key}" cannot change its clock or coalescing delay while active`,
			)
		}
		if (sub.task !== null) {
			sub.clock.cancel(sub.task)
			sub.task = null
			sub.completionResolve?.()
			sub.completion = null
			sub.completionResolve = null
		}
		sub.refcount++
	} else {
		const reconnect = () => {
			if (
				!sub ||
				sub.refcount === 0 ||
				socket.id === undefined ||
				sub.sessionId === socket.id
			) {
				return
			}

			const isFirstConnection = sub.sessionId === undefined
			sub.sessionId = socket.id
			if (isFirstConnection) return

			sub.close()
			sub.close = open(key)
		}
		socket.on(`connect`, reconnect)
		sub = {
			clock,
			close: open(key),
			coalesceMs,
			completion: null,
			completionResolve: null,
			refcount: 1,
			sessionId: socket.id,
			stopWatchingForReconnect: () => {
				socket.off(`connect`, reconnect)
			},
			task: null,
		}
		subMap.set(key, sub)
	}
	let released = false
	return () => {
		if (released) return
		released = true
		sub.refcount--

		if (sub.refcount === 0) {
			sub.completion = new Promise<void>((resolve) => {
				sub.completionResolve = resolve
			})
			sub.task = sub.clock.schedule(
				() => {
					try {
						sub.close()
					} finally {
						sub.stopWatchingForReconnect()
						subMap.delete(key)
						sub.task = null
						sub.completionResolve?.()
						sub.completionResolve = null
					}
				},
				sub.coalesceMs,
				`subscription:${key}`,
			)
		}
	}
}
