import { createWebSocketTransport } from "@atom.io/realtime"
import { pullAtom } from "@atom.io/realtime/client"
import { atom } from "atom.io"
import { IMPLICIT } from "atom.io/internal"

const countAtom = atom<number>({ key: `count`, default: 0 })
const socket = createWebSocketTransport(
	new WebSocket(`wss://example.com/realtime`),
	{
		sessionId: crypto.randomUUID(),
		maxMessageBytes: 262_144,
		maxBufferedBytes: 1_048_576,
	},
)
const stop = pullAtom(IMPLICIT.STORE, socket, countAtom)

// The application controls reconnection/backoff; active services retain listeners.
export function reconnect(): void {
	socket.replace(
		new WebSocket(`wss://example.com/realtime`),
		crypto.randomUUID(),
	)
}
export function dispose(): void {
	stop()
	socket.dispose()
}
