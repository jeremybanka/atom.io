import { Future } from "atom.io/foundations/future"
import type { Socket } from "atom.io/realtime"

type SubData = {
	close: () => void
	refcount: number
	sessionId: string | undefined
	stopWatchingForReconnect: () => void
	timer: Future<void>
}

const SUBSCRIPTION_COALESCE_MS = 50

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
): () => void {
	const subMap = getSubMap(socket)
	let sub = subMap.get(key)

	if (sub) {
		sub.timer.use(new Promise<void>(() => {}))
		sub.refcount++
	} else {
		const reconnect = () => {
			if (!sub || socket.id === undefined || sub.sessionId === socket.id) {
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
			close: open(key),
			refcount: 1,
			sessionId: socket.id,
			stopWatchingForReconnect: () => {
				socket.off(`connect`, reconnect)
			},
			timer: new Future<void>(() => {}),
		}
		subMap.set(key, sub)
		const newSub = sub
		void newSub.timer.then(() => {
			newSub.close()
			newSub.stopWatchingForReconnect()
			subMap.delete(key)
		})
	}
	return () => {
		sub.refcount--

		if (sub.refcount === 0) {
			const timeout = new Promise<void>((resolve) => {
				setTimeout(resolve, SUBSCRIPTION_COALESCE_MS)
			})
			sub.timer.use(timeout)
		}
	}
}
