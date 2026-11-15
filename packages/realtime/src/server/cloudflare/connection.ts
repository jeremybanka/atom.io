import type { RealtimeWebSocket, WebSocketTransport } from "@atom.io/realtime"
import { createWebSocketTransport } from "@atom.io/realtime"

export type AcceptedRealtimeWebSocket = RealtimeWebSocket & { accept(): void }
export type CloudflareRealtimeConnection<Identity> = {
	readonly identity: Identity
	readonly socket: WebSocketTransport
	dispose(): Promise<void>
}

/**
 * Standard (non-hibernating) Workers WebSocket connection. Authenticate before
 * accept; install services before returning the upgrade response to the browser.
 */
export async function acceptCloudflareRealtimeConnection<Identity>(options: {
	readonly webSocket: AcceptedRealtimeWebSocket
	readonly request: Request
	readonly authenticate: (request: Request) => Promise<Identity>
	readonly sessionId: string
	readonly setup: (
		socket: WebSocketTransport,
		identity: Identity,
	) => (() => void | Promise<void>) | Promise<() => void | Promise<void>>
	readonly maxMessageBytes?: number
	readonly onError?: (error: Error) => void
}): Promise<CloudflareRealtimeConnection<Identity>> {
	const identity = await options.authenticate(options.request)
	const report = (error: unknown): void => {
		try {
			options.onError?.(
				error instanceof Error ? error : new Error(String(error)),
			)
		} catch {
			/* diagnostics cannot prevent cleanup */
		}
	}
	let socket: WebSocketTransport
	try {
		options.webSocket.accept()
		socket = createWebSocketTransport(options.webSocket, {
			sessionId: options.sessionId,
			...(options.maxMessageBytes === undefined
				? {}
				: { maxMessageBytes: options.maxMessageBytes }),
			onError: report,
		})
	} catch (error) {
		try {
			options.webSocket.close(1011, `Realtime setup failed`)
		} catch (closeError) {
			report(closeError)
		}
		throw error
	}
	let cleanup: (() => void | Promise<void>) | undefined
	let disposed: Promise<void> | undefined
	let finishSetup!: () => void
	const setupDone = new Promise<void>((resolve) => {
		finishSetup = resolve
	})
	const dispose = (): Promise<void> => {
		disposed ??= (async () => {
			await setupDone
			try {
				await cleanup?.()
			} finally {
				socket.dispose()
			}
		})()
		return disposed
	}
	socket.on(`disconnect`, () => {
		void dispose().catch(report)
	})
	try {
		cleanup = await options.setup(socket, identity)
	} catch (error) {
		finishSetup()
		await dispose()
		throw error
	} finally {
		finishSetup()
	}
	return { identity, socket, dispose }
}
