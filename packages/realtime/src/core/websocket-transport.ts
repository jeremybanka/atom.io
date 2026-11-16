import type { Json } from "atom.io/foundations/json"

import { encodeRealtimePayload } from "./realtime-command.ts"
import type {
	AllEventsListener,
	EventListener,
	Socket,
} from "./socket-interface.ts"

/** Structural subset supported by browser and Workers standard WebSockets. */
export type RealtimeWebSocket = {
	readonly readyState: number
	readonly bufferedAmount?: number
	addEventListener(type: string, listener: (event: any) => void): void
	removeEventListener(type: string, listener: (event: any) => void): void
	send(data: string): void
	close(code?: number, reason?: string): void
}
export type WebSocketTransportOptions = {
	/** Connection identity, not an authenticated actor. Change it on replacement. */
	readonly sessionId: string
	readonly maxMessageBytes?: number
	readonly maxBufferedBytes?: number
	readonly onError?: (error: Error) => void
}
export type WebSocketTransport = Socket & {
	/** Replace a closed connection while retaining active service listeners. */
	replace(webSocket: RealtimeWebSocket, sessionId: string): void
	dispose(): void
}

const lifecycle = new Set([`connect`, `disconnect`, `connect_error`])

/** Named events over versioned JSON frames; no Socket.IO dependency. Initial connection buffering is bounded. */
export function createWebSocketTransport(
	initial: RealtimeWebSocket,
	options: WebSocketTransportOptions,
): WebSocketTransport {
	const maxBytes = options.maxMessageBytes ?? 1_048_576
	const maxBuffered = options.maxBufferedBytes ?? maxBytes * 4
	for (const limit of [maxBytes, maxBuffered]) {
		if (!Number.isSafeInteger(limit) || limit < 1)
			throw new Error(`WebSocket byte limits must be positive safe integers.`)
	}
	const encoder = new TextEncoder()
	const listeners = new Map<string, Set<EventListener>>()
	const incoming = new Set<AllEventsListener>()
	const outgoing = new Set<AllEventsListener>()
	let connection: RealtimeWebSocket
	let sessionId: string
	let activeId: string | undefined
	let disposed = false
	let queued: string[] = []
	let queuedBytes = 0
	let detach = (): void => {}
	const report = (error: unknown): void => {
		try {
			options.onError?.(
				error instanceof Error ? error : new Error(String(error)),
			)
		} catch {
			/* reporting must not affect delivery */
		}
	}
	const invoke = (listener: () => void): void => {
		try {
			listener()
		} catch (error) {
			report(error)
		}
	}
	const dispatch = (event: string, args: Json.Serializable[]): void => {
		if (!lifecycle.has(event))
			for (const listener of [...incoming])
				invoke(() => {
					listener(event, ...args)
				})
		for (const listener of [...(listeners.get(event) ?? [])])
			invoke(() => {
				listener(...args)
			})
	}
	const disconnected = (): void => {
		if (activeId === undefined) return
		activeId = undefined
		dispatch(`disconnect`, [])
	}
	const attach = (socket: RealtimeWebSocket, nextSession: string): void => {
		if (!nextSession || nextSession.length > 512)
			throw new Error(
				`A WebSocket connection needs a bounded nonempty session ID.`,
			)
		connection = socket
		sessionId = nextSession
		const open = (): void => {
			if (disposed || connection !== socket || activeId !== undefined) return
			activeId = sessionId
			const frames = queued
			queued = []
			queuedBytes = 0
			try {
				for (const frame of frames) socket.send(frame)
				dispatch(`connect`, [])
			} catch (error) {
				report(error)
				try {
					socket.close(1011, `Realtime send failed`)
				} finally {
					disconnected()
				}
			}
		}
		const message = (event: { data: unknown }): void => {
			if (disposed || connection !== socket || activeId === undefined) return
			try {
				if (
					typeof event.data !== `string` ||
					encoder.encode(event.data).length > maxBytes
				)
					throw new Error(`Invalid or oversized realtime WebSocket frame.`)
				const frame = JSON.parse(event.data) as {
					v?: unknown
					event?: unknown
					args?: unknown
				}
				if (
					encodeRealtimePayload(frame, maxBytes) === null ||
					frame === null ||
					frame.v !== 1 ||
					typeof frame.event !== `string` ||
					!frame.event ||
					frame.event.length > 512 ||
					lifecycle.has(frame.event) ||
					!Array.isArray(frame.args)
				)
					throw new Error(`Unsupported realtime WebSocket frame.`)
				dispatch(frame.event, frame.args)
			} catch (error) {
				report(error)
				socket.close(1008, `Invalid realtime frame`)
				disconnected()
			}
		}
		const close = (): void => {
			if (connection === socket) disconnected()
		}
		const error = (): void => {
			report(new Error(`Realtime WebSocket transport failed.`))
			close()
		}
		socket.addEventListener(`open`, open)
		socket.addEventListener(`message`, message)
		socket.addEventListener(`close`, close)
		socket.addEventListener(`error`, error)
		detach = () => {
			socket.removeEventListener(`open`, open)
			socket.removeEventListener(`message`, message)
			socket.removeEventListener(`close`, close)
			socket.removeEventListener(`error`, error)
		}
		// Already accepted Workers sockets must be usable synchronously by providers.
		if (socket.readyState === 1) activeId = sessionId
	}
	const transport: WebSocketTransport = {
		get id() {
			return activeId
		},
		on(event, listener) {
			let group = listeners.get(event)
			if (!group) {
				group = new Set()
				listeners.set(event, group)
			}
			group.add(listener)
		},
		off(event, listener) {
			if (listener) listeners.get(event)?.delete(listener)
			else listeners.delete(event)
		},
		onAny(listener) {
			incoming.add(listener)
		},
		offAny(listener) {
			if (listener) incoming.delete(listener)
			else incoming.clear()
		},
		onAnyOutgoing(listener) {
			outgoing.add(listener)
		},
		emit(event, ...args) {
			// Cleanup may emit an unsubscribe after a delayed/coalesced disposer.
			// Do not replay frames from a closed session into its replacement.
			if (
				disposed ||
				connection.readyState > 1 ||
				(connection.readyState === 1 && activeId === undefined)
			)
				return
			if (!event || event.length > 512 || lifecycle.has(event))
				throw new Error(`Invalid realtime event name.`)
			const frame = encodeRealtimePayload({ v: 1, event, args }, maxBytes)
			if (frame === null)
				throw new Error(`Invalid or oversized realtime payload.`)
			const size = encoder.encode(frame).length
			if (
				size > maxBytes ||
				(connection.bufferedAmount ?? 0) + queuedBytes + size > maxBuffered
			)
				throw new Error(`Realtime WebSocket backpressure limit exceeded.`)
			if (connection.readyState === 0) {
				queued.push(frame)
				queuedBytes += size
			} else connection.send(frame)
			for (const listener of [...outgoing])
				invoke(() => {
					listener(event, ...args)
				})
		},
		replace(socket, nextSession) {
			if (disposed) throw new Error(`Realtime WebSocket transport is disposed.`)
			if (!nextSession || nextSession.length > 512 || nextSession === sessionId)
				throw new Error(`Replacement needs a new session ID.`)
			detach()
			queued = []
			queuedBytes = 0
			disconnected()
			connection.close(1000, `Replaced`)
			attach(socket, nextSession)
			if (activeId !== undefined) dispatch(`connect`, [])
		},
		dispose() {
			if (disposed) return
			disposed = true
			detach()
			queued = []
			queuedBytes = 0
			disconnected()
			listeners.clear()
			incoming.clear()
			outgoing.clear()
			connection.close(1000, `Disposed`)
		},
	}
	attach(initial, options.sessionId)
	return transport
}
