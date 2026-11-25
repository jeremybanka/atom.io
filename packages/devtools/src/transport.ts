import type { PanelMessage, RemoteMessage } from "./remote-protocol.ts"

/** One reliable and ordered connection. Deliver frames in later tasks, after pending microtasks. */
export interface DevtoolsTransport<Incoming, Outgoing> {
	send(message: Outgoing): void
	/** Report connection loss even when the peer cannot send a protocol close frame. */
	listen(receive: (message: Incoming) => void, disconnected: () => void): void
	/** Close the connection and remove its listeners. Safe to call repeatedly. */
	close(): void
}

export type DevtoolsPanelTransport = DevtoolsTransport<
	RemoteMessage,
	PanelMessage
>
export type DevtoolsStoreTransport = DevtoolsTransport<
	PanelMessage,
	RemoteMessage
>

export function closeDevtoolsTransport(
	transport: { send(message: { type: `close` }): void; close(): void },
	notify: boolean,
): void {
	try {
		if (notify) transport.send({ type: `close` })
	} catch {
		// The peer may already have disconnected.
	} finally {
		transport.close()
	}
}

export function batchDevtoolsUpdates(
	publish: () => void,
	disconnect: () => void,
): () => void {
	let scheduled = false
	return () => {
		if (scheduled) return
		scheduled = true
		queueMicrotask(() => {
			scheduled = false
			try {
				publish()
			} catch {
				disconnect()
			}
		})
	}
}

export function reportDevtoolsError(
	transport: DevtoolsStoreTransport,
	error: unknown,
	disconnect: () => void,
): void {
	try {
		transport.send({
			type: `edit-error`,
			message: error instanceof Error ? error.message : String(error),
		})
	} catch {
		disconnect()
	}
}
