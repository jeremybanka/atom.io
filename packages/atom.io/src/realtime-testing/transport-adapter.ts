import * as http from "node:http"

import type { Socket } from "atom.io/realtime"
import { Server as SocketIOServer } from "socket.io"
import { io } from "socket.io-client"

import type { DeterministicTransportOptions } from "./deterministic-transport"
import { DeterministicTransport } from "./deterministic-transport"

export type TestTransportEndpointOptions = {
	readonly id: string
	readonly session?: string
}

export type TestTransportConnection = {
	readonly client: Socket
	readonly dispose: () => Promise<void>
	readonly server: Socket
}

/**
 * Shared boundary implemented by deterministic memory and real Socket.IO.
 *
 * Harness features should depend on this contract when they only require a
 * connected duplex. Transport-specific controllers remain available through
 * their concrete adapter types.
 */
export interface RealtimeTestTransportAdapter {
	readonly kind: `deterministic` | `socket.io`
	connect(options?: {
		readonly client?: TestTransportEndpointOptions
		readonly server?: TestTransportEndpointOptions
	}): Promise<TestTransportConnection>
}

export class DeterministicTransportAdapter implements RealtimeTestTransportAdapter {
	public readonly kind = `deterministic` as const
	public readonly transport: DeterministicTransport

	public constructor(options?: DeterministicTransportOptions) {
		this.transport = new DeterministicTransport(options)
	}

	public connect(
		options: {
			readonly client?: TestTransportEndpointOptions
			readonly server?: TestTransportEndpointOptions
		} = {},
	): Promise<TestTransportConnection> {
		const duplex = this.transport.createDuplex(
			{
				id: options.client?.id ?? `client`,
				role: `client`,
				...(options.client?.session === undefined
					? {}
					: { session: options.client.session }),
			},
			{
				id: options.server?.id ?? `server`,
				role: `server`,
				...(options.server?.session === undefined
					? {}
					: { session: options.server.session }),
			},
		)
		return Promise.resolve({
			client: duplex.left,
			dispose: async () => {},
			server: duplex.right,
		})
	}
}

export type SocketIOTransportAdapterOptions = {
	readonly clientOptions?: Parameters<typeof io>[1]
}

/** Real transport integration adapter used by the same contract as memory. */
export class SocketIOTransportAdapter implements RealtimeTestTransportAdapter {
	public readonly kind = `socket.io` as const
	readonly #options: SocketIOTransportAdapterOptions

	public constructor(options: SocketIOTransportAdapterOptions = {}) {
		this.#options = options
	}

	public async connect(): Promise<TestTransportConnection> {
		const httpServer = http.createServer()
		const socketServer = new SocketIOServer(httpServer)
		await new Promise<void>((resolve, reject) => {
			httpServer.once(`error`, reject)
			httpServer.listen(0, `127.0.0.1`, () => {
				httpServer.off(`error`, reject)
				resolve()
			})
		})
		const address = httpServer.address()
		if (address === null || typeof address === `string`) {
			await new Promise<void>((resolve) =>
				socketServer.close(() => {
					resolve()
				}),
			)
			throw new Error(`Socket.IO adapter could not determine its test port`)
		}

		try {
			const serverSocketPromise = new Promise<Socket>((resolve) => {
				socketServer.once(`connection`, (socket) => {
					resolve(socket)
				})
			})
			const clientSocket = io(`http://127.0.0.1:${address.port}`, {
				forceNew: true,
				reconnection: false,
				transports: [`websocket`],
				...this.#options.clientOptions,
			})
			const connectedPromise = new Promise<void>((resolve, reject) => {
				clientSocket.once(`connect`, resolve)
				clientSocket.once(`connect_error`, reject)
			})
			const [serverSocket] = await Promise.all([
				serverSocketPromise,
				connectedPromise,
			])
			return {
				client: clientSocket,
				dispose: async () => {
					clientSocket.disconnect()
					await new Promise<void>((resolve) =>
						socketServer.close(() => {
							resolve()
						}),
					)
				},
				server: serverSocket,
			}
		} catch (error) {
			await new Promise<void>((resolve) =>
				socketServer.close(() => {
					resolve()
				}),
			)
			throw error
		}
	}
}

export const createDeterministicTransportAdapter = (
	options?: DeterministicTransportOptions,
): DeterministicTransportAdapter => new DeterministicTransportAdapter(options)

export const createSocketIOTransportAdapter = (
	options?: SocketIOTransportAdapterOptions,
): SocketIOTransportAdapter => new SocketIOTransportAdapter(options)
