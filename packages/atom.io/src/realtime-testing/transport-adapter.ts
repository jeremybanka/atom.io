import * as http from "node:http"

import type { Socket } from "atom.io/realtime"
import { Server as SocketIOServer } from "socket.io"
import type { Socket as SocketIOClientSocket } from "socket.io-client"
import { io } from "socket.io-client"

import type { DeterministicTransportOptions } from "./deterministic-transport"
import { DeterministicTransport } from "./deterministic-transport"

export type TestTransportEndpointOptions = {
	/** Logical test identifier; transport-generated socket IDs remain unchanged. */
	readonly id: string
	/** Logical session identifier, useful for modeling multiple tabs or reconnects. */
	readonly session?: string
}

export type TestTransportConnection = {
	readonly client: Socket
	readonly dispose: () => Promise<void>
	readonly endpoints: {
		readonly client: TestTransportEndpoint
		readonly server: TestTransportEndpoint
	}
	readonly server: Socket
}

export type TestTransportEndpoint = {
	readonly id: string
	readonly session: string
}

export type TestTransportConnectionOptions = {
	readonly client?: TestTransportEndpointOptions
	readonly server?: TestTransportEndpointOptions
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
	connect(
		options?: TestTransportConnectionOptions,
	): Promise<TestTransportConnection>
}

const endpoint = (
	options: TestTransportEndpointOptions | undefined,
	fallback: string,
): TestTransportEndpoint => {
	const id = options?.id ?? fallback
	const session = options?.session ?? id
	if (id.length === 0) throw new Error(`Transport endpoint id cannot be empty`)
	if (session.length === 0) {
		throw new Error(`Transport endpoint session cannot be empty`)
	}
	return { id, session }
}

export class DeterministicTransportAdapter implements RealtimeTestTransportAdapter {
	public readonly kind = `deterministic` as const
	public readonly transport: DeterministicTransport

	public constructor(options?: DeterministicTransportOptions) {
		this.transport = new DeterministicTransport(options)
	}

	public connect(
		options: TestTransportConnectionOptions = {},
	): Promise<TestTransportConnection> {
		const clientEndpoint = endpoint(options.client, `client`)
		const serverEndpoint = endpoint(options.server, `server`)
		const duplex = this.transport.createDuplex(
			{
				id: clientEndpoint.id,
				role: `client`,
				session: clientEndpoint.session,
			},
			{
				id: serverEndpoint.id,
				role: `server`,
				session: serverEndpoint.session,
			},
		)
		return Promise.resolve({
			client: duplex.left,
			dispose: async () => {},
			endpoints: { client: clientEndpoint, server: serverEndpoint },
			server: duplex.right,
		})
	}
}

export type SocketIOTransportAdapterOptions = {
	readonly clientOptions?: Parameters<typeof io>[1]
}

export type SocketIOHarness = {
	readonly port: number
	readonly server: SocketIOServer
	readonly serverEndpoint: TestTransportEndpoint
}

export type SocketIOHarnessClientOptions = {
	readonly auth?: Record<string, unknown>
	readonly autoConnect?: boolean
	readonly endpoint: TestTransportEndpointOptions
}

export const SOCKET_IO_TEST_ENDPOINT_AUTH = `__atomIoRealtimeTestEndpoint`

export type SocketIOTestEndpointAuth = {
	readonly client: TestTransportEndpoint
	readonly server: TestTransportEndpoint
}

/** Real transport integration adapter used by the same contract as memory. */
export class SocketIOTransportAdapter implements RealtimeTestTransportAdapter {
	public readonly kind = `socket.io` as const
	readonly #options: SocketIOTransportAdapterOptions

	public constructor(options: SocketIOTransportAdapterOptions = {}) {
		this.#options = options
	}

	public async connect(
		options: TestTransportConnectionOptions = {},
	): Promise<TestTransportConnection> {
		const clientEndpoint = endpoint(options.client, `client`)
		const serverEndpoint = endpoint(options.server, `server`)
		const httpServer = http.createServer()
		const socketServer = new SocketIOServer(httpServer)
		let clientSocket: SocketIOClientSocket | undefined
		let closed = false
		const close = async (): Promise<void> => {
			if (closed) return
			closed = true
			clientSocket?.disconnect()
			await new Promise<void>((resolve) =>
				socketServer.close(() => {
					resolve()
				}),
			)
			if (httpServer.listening) {
				await new Promise<void>((resolve) => {
					httpServer.close(() => {
						resolve()
					})
				})
			}
		}

		try {
			await new Promise<void>((resolve, reject) => {
				httpServer.once(`error`, reject)
				httpServer.listen(0, `127.0.0.1`, () => {
					httpServer.off(`error`, reject)
					resolve()
				})
			})
			const address = httpServer.address()
			if (address === null || typeof address === `string`) {
				throw new Error(`Socket.IO adapter could not determine its test port`)
			}
			const serverSocketPromise = new Promise<Socket>((resolve, reject) => {
				socketServer.once(`connection`, (socket) => {
					try {
						this.#validateHandshakeEndpoints(
							socket.handshake.auth,
							clientEndpoint,
							serverEndpoint,
						)
						resolve(socket)
					} catch (error) {
						reject(error)
					}
				})
			})
			clientSocket = io(`http://127.0.0.1:${address.port}`, {
				forceNew: true,
				reconnection: false,
				transports: [`websocket`],
				...this.#options.clientOptions,
				auth: this.#auth(clientEndpoint, serverEndpoint),
			})
			const connectedPromise = new Promise<void>((resolve, reject) => {
				const onConnect = () => {
					clientSocket?.off(`connect_error`, onConnectError)
					resolve()
				}
				const onConnectError = (error: Error) => {
					clientSocket?.off(`connect`, onConnect)
					reject(error)
				}
				clientSocket?.once(`connect`, onConnect)
				clientSocket?.once(`connect_error`, onConnectError)
			})
			const [serverSocket] = await Promise.all([
				serverSocketPromise,
				connectedPromise,
			])
			return {
				client: clientSocket,
				dispose: close,
				endpoints: { client: clientEndpoint, server: serverEndpoint },
				server: serverSocket,
			}
		} catch (error) {
			await close()
			throw error
		}
	}

	/**
	 * Open the real Socket.IO host used by the legacy React harness.
	 *
	 * This intentionally remains synchronous to preserve `singleClient` and
	 * `multiClient`; Socket.IO begins accepting clients on the returned port.
	 */
	public openHarness(
		serverOptions: TestTransportEndpointOptions = { id: `server` },
	): SocketIOHarness {
		const serverEndpoint = endpoint(serverOptions, `server`)
		const httpServer = http.createServer((request, response) => {
			response.setHeader(
				`Access-Control-Allow-Headers`,
				`Authorization, Content-Type`,
			)
			response.setHeader(`Access-Control-Allow-Methods`, `GET, POST, OPTIONS`)
			response.setHeader(`Access-Control-Allow-Origin`, `*`)
			if (request.method === `OPTIONS`) {
				response.writeHead(204)
				response.end()
				return
			}
			response.end(`Hello World!`)
		})
		const address = httpServer.listen().address()
		if (address === null || typeof address === `string`) {
			httpServer.close()
			throw new Error(`Socket.IO adapter could not determine its harness port`)
		}
		return {
			port: address.port,
			server: new SocketIOServer(httpServer),
			serverEndpoint,
		}
	}

	/** Connect one legacy-harness client through the same endpoint semantics. */
	public connectHarnessClient(
		harness: SocketIOHarness,
		options: SocketIOHarnessClientOptions,
	): SocketIOClientSocket {
		const clientEndpoint = endpoint(options.endpoint, `client`)
		return io(`http://localhost:${harness.port}/`, {
			...this.#options.clientOptions,
			autoConnect: options.autoConnect ?? true,
			auth: this.#auth(clientEndpoint, harness.serverEndpoint, options.auth),
		})
	}

	/** Validate logical identity at the server boundary, independent of socket ID. */
	public validateHarnessEndpoint(
		auth: Record<string, unknown>,
		expectedClient: TestTransportEndpointOptions,
		expectedServer: TestTransportEndpointOptions,
	): SocketIOTestEndpointAuth {
		const clientEndpoint = endpoint(expectedClient, `client`)
		const serverEndpoint = endpoint(expectedServer, `server`)
		this.#validateHandshakeEndpoints(auth, clientEndpoint, serverEndpoint)
		return { client: clientEndpoint, server: serverEndpoint }
	}

	#validateHandshakeEndpoints(
		auth: Record<string, unknown>,
		expectedClient: TestTransportEndpoint,
		expectedServer: TestTransportEndpoint,
	): void {
		const received = auth[SOCKET_IO_TEST_ENDPOINT_AUTH]
		const expected: SocketIOTestEndpointAuth = {
			client: expectedClient,
			server: expectedServer,
		}
		if (
			typeof received !== `object` ||
			received === null ||
			!(
				`client` in received &&
				`server` in received &&
				JSON.stringify(received.client) === JSON.stringify(expected.client) &&
				JSON.stringify(received.server) === JSON.stringify(expected.server)
			)
		) {
			throw new Error(
				`Socket.IO endpoint metadata mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(received)}`,
			)
		}
	}

	#auth(
		clientEndpoint: TestTransportEndpoint,
		serverEndpoint: TestTransportEndpoint,
		additional?: Record<string, unknown>,
	): Record<string, unknown> {
		const configured = this.#options.clientOptions?.auth
		if (typeof configured === `function`) {
			throw new Error(
				`SocketIOTransportAdapter requires object auth so endpoint metadata can be validated`,
			)
		}
		return {
			...configured,
			...additional,
			[SOCKET_IO_TEST_ENDPOINT_AUTH]: {
				client: clientEndpoint,
				server: serverEndpoint,
			} satisfies SocketIOTestEndpointAuth,
		}
	}
}

export const createDeterministicTransportAdapter = (
	options?: DeterministicTransportOptions,
): DeterministicTransportAdapter => new DeterministicTransportAdapter(options)

export const createSocketIOTransportAdapter = (
	options?: SocketIOTransportAdapterOptions,
): SocketIOTransportAdapter => new SocketIOTransportAdapter(options)
