import { createHash, timingSafeEqual } from "node:crypto"
import type { IncomingMessage, Server } from "node:http"
import type { Server as HttpsServer } from "node:https"
import type { Duplex } from "node:stream"

import { type } from "arktype"
import type { Silo } from "atom.io"
import { WebSocket, WebSocketServer } from "ws"

import type { PanelMessage } from "./remote-protocol.ts"
import { exposeWholeStore } from "./remote-store.ts"
import {
	DEVTOOLS_SOCKET_PROTOCOL,
	encodeStandaloneFrame,
	prepareStandaloneValue,
} from "./standalone-wire.ts"
import type { DevtoolsStoreTransport } from "./transport.ts"

type HttpServer = Server | HttpsServer
export const DEVTOOLS_ENDPOINT = `/atom-io-devtools`
export const MAX_COMMAND_BYTES = 1024 * 1024
export const MAX_STORE_FRAME_BYTES = 64 * 1024 * 1024
const MAX_PENDING_BYTES = 8 * 1024 * 1024

const revision = `number.integer >= 0` as const
const generate = type({ key: `string`, "watch?": revision })
const release = type({ key: `string`, watch: revision })
const panelFrame = generate
	.merge({ type: `'generate'` })
	.or(release.merge({ type: `'release'` }))
	.or({
		type: `'state-requests'`,
		generate: generate.array(),
		release: release.array(),
	})
	.or({ type: `'edit'`, key: `string`, "revision?": revision, value: `unknown` })
	.or({ type: `'dispose'`, key: `string` })
	.or({
		type: `'timeline'`,
		key: `string`,
		"revision?": revision,
		action: `'undo' | 'redo'`,
	})
	.or({ type: `'close'` })

export function devtoolsToken(value: string | undefined): string {
	if (!value || !/^[\x21-\x7e]+$/.test(value))
		throw new Error(
			`Set ATOM_IO_DEVTOOLS_TOKEN to a nonempty token without whitespace`,
		)
	return value
}

export function sendWebSocketFrames(socket: WebSocket, limit: number) {
	let pending = 0
	return (frame: string, snapshot = false): void => {
		const size = Buffer.byteLength(frame)
		if (
			socket.readyState !== WebSocket.OPEN ||
			size > limit ||
			pending > MAX_PENDING_BYTES
		)
			throw new Error(
				`Devtools WebSocket is closed, stalled, or over its frame limit`,
			)
		// Let the first snapshot drain independently of the incremental update queue.
		if (snapshot) socket.send(frame)
		else {
			pending += size
			socket.send(frame, () => {
				pending -= size
			})
		}
	}
}

export function bindDevtoolsSockets(
	server: HttpServer,
	path: string,
	authorize: (request: IncomingMessage) => boolean,
	connect: (socket: WebSocket) => void,
): () => void {
	const sockets = new WebSocketServer({
		noServer: true,
		maxPayload: MAX_COMMAND_BYTES,
	})
	const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
		if (request.url !== path) {
			if (server.listenerCount(`upgrade`) === 1) socket.destroy()
			return
		}
		if (
			!authorize(request) ||
			request.headers[`sec-websocket-protocol`] !== DEVTOOLS_SOCKET_PROTOCOL
		) {
			socket.end(
				`HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
			)
			return
		}
		sockets.handleUpgrade(request, socket, head, (client) => {
			client.on(`error`, () => {
				client.terminate()
			})
			connect(client)
		})
	}
	server.on(`upgrade`, upgrade)
	return () => {
		server.off(`upgrade`, upgrade)
		for (const socket of sockets.clients) socket.terminate()
		sockets.close()
	}
}

function storeTransport(socket: WebSocket): DevtoolsStoreTransport {
	const send = sendWebSocketFrames(socket, MAX_STORE_FRAME_BYTES)
	return {
		send(frame) {
			send(encodeStandaloneFrame(frame), frame.type === `store`)
		},
		listen(receive, disconnected) {
			socket.once(`close`, () => {
				disconnected()
			})
			socket.on(`message`, (data, binary) => {
				try {
					if (binary) throw new Error(`Devtools requires text frames`)
					// ws delivers text frames as a Buffer on Node.
					const frame = panelFrame(JSON.parse((data as Buffer).toString()))
					if (frame instanceof type.errors)
						throw new Error(`Invalid Devtools command frame`)
					receive(frame as PanelMessage)
				} catch {
					socket.close(1008)
				}
			})
		},
		close() {
			socket.close()
		},
	}
}

export interface DevtoolsWebSocketOptions {
	/** Shared bearer token passed by the CLI in ATOM_IO_DEVTOOLS_TOKEN. */
	token: string
	/** Upgrade path on the supplied HTTP server. */
	path?: string
	/** Explicitly permit control in a production Silo or Node process. */
	productionAccess?: `control`
}

/** Attach an authenticated control endpoint to an existing HTTP(S) server. */
export function attachDevtoolsWebSocket(
	server: HttpServer,
	silo: Silo,
	options: DevtoolsWebSocketOptions,
): () => void {
	const canControl = () =>
		options.productionAccess === `control` ||
		(!silo.store.config.isProduction && process.env[`NODE_ENV`] !== `production`)
	if (!canControl())
		throw new Error(
			`Devtools WebSocket requires explicit control access in production`,
		)
	const path = options.path ?? DEVTOOLS_ENDPOINT
	if (!/^\/(?!\/)[^?#\s]+$/.test(path))
		throw new Error(
			`Provide an absolute Devtools WebSocket path without a query or fragment`,
		)
	const expected = createHash(`sha256`)
		.update(devtoolsToken(options.token))
		.digest()
	return bindDevtoolsSockets(
		server,
		path,
		({ headers }) => {
			const bearer = /^Bearer (\S+)$/i.exec(headers.authorization ?? ``)?.[1]
			return (
				!!bearer &&
				canControl() &&
				timingSafeEqual(expected, createHash(`sha256`).update(bearer).digest())
			)
		},
		(socket) => {
			try {
				exposeWholeStore(
					storeTransport(socket),
					silo,
					true,
					prepareStandaloneValue,
				)
			} catch {
				socket.terminate()
			}
		},
	)
}
