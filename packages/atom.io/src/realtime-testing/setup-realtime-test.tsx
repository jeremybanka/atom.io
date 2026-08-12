import { ChildProcess } from "node:child_process"
import * as http from "node:http"

import type { RenderResult } from "@testing-library/react"
import { prettyDOM, render } from "@testing-library/react"
import * as AtomIO from "atom.io"
import { toEntries } from "atom.io/foundations/entries"
import type { Store } from "atom.io/internal"
import { clearStore, IMPLICIT } from "atom.io/internal"
import * as AR from "atom.io/react"
import * as RT from "atom.io/realtime"
import * as RTC from "atom.io/realtime-client"
import * as RTR from "atom.io/realtime-react"
import * as RTS from "atom.io/realtime-server"
import { UList } from "atom.io/transceivers/u-list"
import * as Happy from "happy-dom"
import * as React from "react"
import * as SocketIO from "socket.io"
import type { Socket as ClientSocket } from "socket.io-client"
import { io } from "socket.io-client"

import {
	type RealtimeTestEventCursor,
	RealtimeTestEventJournal,
} from "./event-journal.ts"

let testNumber = 0
let sessionNumber = 0

const BARRIER_REQUEST = `atom.io/realtime-testing:barrier-request`
const BARRIER_RESPONSE = `atom.io/realtime-testing:barrier-response`
const INTERNAL_EVENTS = new Set([BARRIER_REQUEST, BARRIER_RESPONSE])

/* eslint-disable no-console */

function prefixLogger(store: Store, prefix: string) {
	store.loggers[0] = new AtomIO.AtomIOLogger(
		`info`,
		(...params) => {
			let idx = 0
			for (const param of params) {
				if (param instanceof SocketIO.Socket) {
					params[idx] = `Socket:${param.id}`
				}
				if (param instanceof RTS.ChildSocket) {
					params[idx] = `ChildSocket:${param.id}`
				}
				if (param instanceof ChildProcess) {
					params[idx] = `ChildProcess:${param.pid}`
				}
				if (param instanceof UList) {
					params[idx] = `UList(${param.size}) {${[...param].join(`, `)}}`
				}
				idx++
			}
			return params
		},
		{
			info: AtomIO.simpleLog(`info`, prefix),
			warn: AtomIO.simpleLog(`warn`, prefix),
			error: AtomIO.simpleLog(`error`, prefix),
		},
	)
}

export type RealtimeTestServerTools = {
	socket: SocketIO.Socket
	silo: AtomIO.Silo
	userKey: RT.UserKey
	/** Identifies one connection independently from its authenticated identity. */
	sessionId: string
	enableLogging: () => void
}

export type TestSetupOptions = {
	immortal?: { server?: boolean }
	server: (tools: RealtimeTestServerTools) => (() => void) | void
}
export type TestSetupOptions__SingleClient = TestSetupOptions & {
	client: React.FC
}
export type TestSetupOptions__MultiClient<ClientNames extends string> =
	TestSetupOptions & {
		clients: {
			[K in ClientNames]: React.FC
		}
	}

export type RealtimeTestTools = {
	name: string
	silo: AtomIO.Silo
}

/** Options for a dynamically created, independently owned test client. */
export type RealtimeTestClientOptions = {
	name: string
	/** Defaults to a unique identity derived from `name`. */
	userKey?: RT.UserKey
	/** Defaults to a unique session. Supply this only when replaying a scenario. */
	sessionId?: string
	/** Defaults to true. */
	autoConnect?: boolean
}

/** A headless client with its own store, identity, session, socket and lifecycle. */
export type HeadlessRealtimeTestClient = RealtimeTestTools & {
	dispose: () => Promise<void>
	enableLogging: () => void
	journal: RealtimeTestEventJournal
	sessionId: string
	socket: ClientSocket
	userKey: RT.UserKey
	/**
	 * Wait until all transport work ordered before a bidirectional barrier has run.
	 * Timed work scheduled by application code is deliberately outside this contract.
	 */
	waitForIdle: (options?: WaitForIdleOptions) => Promise<void>
}

export type RealtimeTestClient = HeadlessRealtimeTestClient & {
	renderResult: RenderResult
	prettyPrint: () => void
}
export type RealtimeTestClientBuilder = {
	/** Dispose every still-live instance created by this builder. */
	dispose: () => Promise<void>
	/** Create a new independent instance. It is valid to call `init` repeatedly. */
	init: (options?: Partial<RealtimeTestClientOptions>) => RealtimeTestClient
	/** Wait for every still-live instance created by this builder. */
	waitForIdle: (options?: WaitForIdleOptions) => Promise<void>
}

export type WaitForIdleOptions = {
	/** Maximum wall-clock wait. Defaults to 1,000 milliseconds. */
	timeout?: number
	/** Consecutive unchanged barrier rounds required. Defaults to two. */
	stableRounds?: number
}

export type RealtimeTestServer = RealtimeTestTools & {
	/** @deprecated Prefer `journal.waitForEvent`, which returns the occurrence. */
	awaitEvent: (
		consumer: RT.UserKey,
		event: string,
		after?: RealtimeTestEventCursor,
	) => Promise<void>
	dispose: () => Promise<void>
	journal: RealtimeTestEventJournal
	port: number
}

export type RealtimeTestAPI = {
	server: RealtimeTestServer
	teardown: () => Promise<void>
	waitForIdle: (options?: WaitForIdleOptions) => Promise<void>
}
export type RealtimeTestAPI__Headless = RealtimeTestAPI & {
	/** Create a client at any point in the scenario. */
	createClient: (
		options: RealtimeTestClientOptions,
	) => HeadlessRealtimeTestClient
}
export type RealtimeTestAPI__SingleClient = RealtimeTestAPI & {
	client: RealtimeTestClientBuilder
}
export type RealtimeTestAPI__MultiClient<ClientNames extends string> =
	RealtimeTestAPI & {
		clients: Record<ClientNames, RealtimeTestClientBuilder>
	}

type InternalRealtimeTestServer = RealtimeTestServer & {
	registerClient: (client: HeadlessRealtimeTestClient) => void
	unregisterClient: (client: HeadlessRealtimeTestClient) => void
}

type InternalRealtimeTestClientBuilder = RealtimeTestClientBuilder & {
	liveInstances: ReadonlySet<RealtimeTestClient>
}

const timeoutError = (
	message: string,
	journal: RealtimeTestEventJournal,
): Error => new Error(`${message}\n${journal.transcript({ limit: 30 })}`)

const withTimeout = async <T,>(
	promise: Promise<T>,
	timeout: number,
	onTimeout: () => Error,
): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(onTimeout()), timeout)
			}),
		])
	} finally {
		if (timer) clearTimeout(timer)
	}
}

const waitForClientsIdle = async (
	clients: Iterable<HeadlessRealtimeTestClient>,
	journal: RealtimeTestEventJournal,
	options: WaitForIdleOptions = {},
): Promise<void> => {
	const timeout = options.timeout ?? 1_000
	const stableRounds = options.stableRounds ?? 2
	if (!Number.isInteger(stableRounds) || stableRounds < 1) {
		throw new Error(`stableRounds must be a positive integer`)
	}
	const started = Date.now()
	let stable = 0
	let previousCursor = journal.cursor()
	while (stable < stableRounds) {
		for (const client of clients) {
			const remaining = timeout - (Date.now() - started)
			if (remaining <= 0) {
				throw timeoutError(
					`Timed out waiting for the realtime scenario to become idle`,
					journal,
				)
			}
			await client.waitForIdle({ timeout: remaining, stableRounds: 1 })
		}
		const cursor = journal.cursor()
		stable = cursor === previousCursor ? stable + 1 : 0
		previousCursor = cursor
	}
}

export const setupRealtimeTestServer = (
	options: TestSetupOptions,
): RealtimeTestServer => {
	++testNumber
	const journal = new RealtimeTestEventJournal()
	const clients = new Set<HeadlessRealtimeTestClient>()
	const silo = new AtomIO.Silo(
		{
			name: `SERVER-${testNumber}`,
			lifespan: options.immortal?.server ? `immortal` : `ephemeral`,
			isProduction: false,
		},
		IMPLICIT.STORE,
	)

	const httpServer = http.createServer((_, res) => res.end(`Hello World!`))
	const address = httpServer.listen().address()
	const port =
		typeof address === `string` ? null : address === null ? null : address.port
	if (port === null) throw new Error(`Could not determine port for test server`)

	const server = new SocketIO.Server(httpServer)
	const disposeRealtime = RTS.realtime(
		server,
		(handshake) => {
			const { token, username } = handshake.auth
			if (RT.isUserKey(username) && token === `test`) return username
			return new Error(`Authentication error`)
		},
		(config) => {
			const socket = config.socket as SocketIO.Socket
			const userKey = config.consumer
			const sessionId =
				typeof socket.handshake.auth[`sessionId`] === `string`
					? socket.handshake.auth[`sessionId`]
					: socket.id
			const record = (
				direction: `server:incoming` | `server:outgoing`,
				event: string,
				args: unknown[],
			) => {
				if (INTERNAL_EVENTS.has(event)) return
				journal.record({
					args,
					destination: direction === `server:incoming` ? `server` : sessionId,
					direction,
					event,
					sessionId,
					source: direction === `server:incoming` ? sessionId : `server`,
					userKey,
				})
			}
			socket.onAny((event, ...args) => record(`server:incoming`, event, args))
			socket.onAnyOutgoing((event, ...args) =>
				record(`server:outgoing`, event, args),
			)
			socket.on(BARRIER_REQUEST, (_nonce: string, acknowledge: () => void) => {
				socket.emit(BARRIER_RESPONSE, _nonce, acknowledge)
			})

			function enableLogging() {
				prefixLogger(silo.store, `server`)
				socket.onAny((event, ...args) => {
					console.log(`🛰 `, userKey, event, ...args)
				})
				socket.onAnyOutgoing((event, ...args) => {
					console.log(`🛰  >>`, userKey, event, ...args)
				})
				socket.on(`disconnect`, () => {
					console.log(`${userKey} disconnected`)
				})
			}
			const disposeServices = options.server({
				socket,
				userKey,
				sessionId,
				enableLogging,
				silo,
			})
			return () => disposeServices?.()
		},
		silo.store,
	)

	let disposed = false
	const result: InternalRealtimeTestServer = {
		awaitEvent: async (consumer, event, after = 0) => {
			await journal.waitForEvent({
				after,
				direction: `server:incoming`,
				event,
				userKey: consumer,
			})
		},
		dispose: async () => {
			if (disposed) return
			disposed = true
			await disposeRealtime()
			journal.dispose()
			clearStore(silo.store)
		},
		journal,
		name: `SERVER`,
		port,
		registerClient: (client) => clients.add(client),
		silo,
		unregisterClient: (client) => clients.delete(client),
	}
	return result
}

const createHeadlessClient = (
	options: RealtimeTestClientOptions,
	server: InternalRealtimeTestServer,
): HeadlessRealtimeTestClient => {
	const sessionId =
		options.sessionId ?? `session-${testNumber}-${++sessionNumber}`
	const userKey =
		options.userKey ?? (`user::${options.name}-${testNumber}` as RT.UserKey)
	const socket: ClientSocket = io(`http://localhost:${server.port}/`, {
		autoConnect: options.autoConnect ?? true,
		auth: { token: `test`, username: userKey, sessionId },
	})
	const silo = new AtomIO.Silo(
		{ name: options.name, lifespan: `ephemeral`, isProduction: false },
		IMPLICIT.STORE,
	)
	const record = (
		direction: `client:incoming` | `client:outgoing`,
		event: string,
		args: unknown[],
	) => {
		if (INTERNAL_EVENTS.has(event)) return
		server.journal.record({
			args,
			destination: direction === `client:incoming` ? sessionId : `server`,
			direction,
			event,
			sessionId,
			source: direction === `client:incoming` ? `server` : sessionId,
			userKey,
		})
	}
	socket.onAny((event, ...args) => record(`client:incoming`, event, args))
	socket.onAnyOutgoing((event, ...args) =>
		record(`client:outgoing`, event, args),
	)
	socket.on(BARRIER_RESPONSE, (_nonce: string, acknowledge: () => void) => {
		acknowledge()
	})

	let disposed = false
	let barrierNumber = 0
	const client: HeadlessRealtimeTestClient = {
		dispose: async () => {
			if (disposed) return
			await RTC.observeSocketWindDown(socket)
			if (socket.connected) await client.waitForIdle()
			disposed = true
			socket.removeAllListeners()
			socket.disconnect()
			clearStore(silo.store)
			server.unregisterClient(client)
		},
		enableLogging: () => {
			prefixLogger(silo.store, options.name)
			socket.onAny((event, ...args) => {
				console.log(`📡 `, options.name, event, ...args)
			})
			socket.onAnyOutgoing((event, ...args) => {
				console.log(`📡  >>`, options.name, event, ...args)
			})
		},
		journal: server.journal,
		name: options.name,
		sessionId,
		silo,
		socket,
		userKey,
		waitForIdle: async ({ timeout = 1_000, stableRounds = 2 } = {}) => {
			if (disposed)
				throw new Error(`Realtime test client ${sessionId} is disposed`)
			if (!Number.isInteger(stableRounds) || stableRounds < 1) {
				throw new Error(`stableRounds must be a positive integer`)
			}
			if (!socket.connected) {
				await withTimeout(
					new Promise<void>((resolve, reject) => {
						socket.once(`connect`, resolve)
						socket.once(`connect_error`, reject)
					}),
					timeout,
					() =>
						timeoutError(
							`Timed out waiting for ${sessionId} to connect`,
							server.journal,
						),
				)
			}
			const started = Date.now()
			let stable = 0
			let previousCursor = server.journal.cursor()
			while (stable < stableRounds) {
				const remaining = timeout - (Date.now() - started)
				if (remaining <= 0) {
					throw timeoutError(
						`Timed out waiting for ${sessionId} to become idle`,
						server.journal,
					)
				}
				const nonce = `${sessionId}:${++barrierNumber}`
				await withTimeout(
					new Promise<void>((resolve) => {
						socket.emit(BARRIER_REQUEST, nonce, resolve)
					}),
					remaining,
					() =>
						timeoutError(
							`Timed out waiting for the ${sessionId} transport barrier`,
							server.journal,
						),
				)
				await Promise.resolve()
				const cursor = server.journal.cursor()
				stable = cursor === previousCursor ? stable + 1 : 0
				previousCursor = cursor
			}
		},
	}
	server.registerClient(client)
	return client
}

/**
 * Create a scenario with dynamically creatable clients and no renderer.
 *
 * Multiple clients may deliberately share a `userKey`; their `sessionId`, socket,
 * silo, and disposal remain independent.
 */
export const headless = (
	options: TestSetupOptions,
): RealtimeTestAPI__Headless => {
	const server = setupRealtimeTestServer(options) as InternalRealtimeTestServer
	const clients = new Set<HeadlessRealtimeTestClient>()
	const createClient = (clientOptions: RealtimeTestClientOptions) => {
		const client = createHeadlessClient(clientOptions, server)
		clients.add(client)
		const dispose = client.dispose
		client.dispose = async () => {
			await dispose()
			clients.delete(client)
		}
		return client
	}
	return {
		createClient,
		server,
		teardown: async () => {
			await Promise.all([...clients].map((client) => client.dispose()))
			await server.dispose()
		},
		waitForIdle: async (idleOptions) => {
			await waitForClientsIdle(clients, server.journal, idleOptions)
		},
	}
}

export const setupRealtimeTestClient = (
	options: TestSetupOptions__SingleClient,
	name: string,
	server: RealtimeTestServer,
): RealtimeTestClientBuilder => {
	const internalServer = server as InternalRealtimeTestServer
	const instances = new Set<RealtimeTestClient>()
	const builder: InternalRealtimeTestClientBuilder = {
		dispose: async () => {
			await Promise.all([...instances].map((client) => client.dispose()))
		},
		init: (overrides = {}) => {
			const headlessClient = createHeadlessClient(
				{ name, ...overrides },
				internalServer,
			)
			const { document } = new Happy.Window()
			document.body.innerHTML = `<div id="app"></div>`
			const renderResult = render(
				<AR.StoreProvider store={headlessClient.silo.store}>
					<RTR.RealtimeProvider socket={headlessClient.socket}>
						<options.client />
					</RTR.RealtimeProvider>
				</AR.StoreProvider>,
				{
					container: document.querySelector(`#app`) as unknown as HTMLElement,
				},
			)
			const client: RealtimeTestClient = {
				...headlessClient,
				dispose: async () => {
					if (!instances.has(client)) return
					renderResult.unmount()
					await headlessClient.dispose()
					instances.delete(client)
				},
				prettyPrint: () => console.log(prettyDOM(renderResult.container)),
				renderResult,
			}
			instances.add(client)
			return client
		},
		liveInstances: instances,
		waitForIdle: async (idleOptions) => {
			await waitForClientsIdle(instances, server.journal, idleOptions)
		},
	}
	return builder
}

export const singleClient = (
	options: TestSetupOptions__SingleClient,
): RealtimeTestAPI__SingleClient => {
	const server = setupRealtimeTestServer(options)
	const client = setupRealtimeTestClient(options, `CLIENT`, server)
	return {
		client,
		server,
		teardown: async () => {
			await client.dispose()
			await server.dispose()
		},
		waitForIdle: async (idleOptions) => {
			await waitForClientsIdle(
				(client as InternalRealtimeTestClientBuilder).liveInstances,
				server.journal,
				idleOptions,
			)
		},
	}
}

export const multiClient = <ClientNames extends string>(
	options: TestSetupOptions__MultiClient<ClientNames>,
): RealtimeTestAPI__MultiClient<ClientNames> => {
	const server = setupRealtimeTestServer(options)
	const clients = toEntries(options.clients).reduce(
		(clientRecord, [name, client]) => {
			clientRecord[name] = setupRealtimeTestClient(
				{ ...options, client },
				name,
				server,
			)
			return clientRecord
		},
		{} as Record<ClientNames, RealtimeTestClientBuilder>,
	)
	return {
		clients,
		server,
		teardown: async () => {
			for (const [, client] of toEntries(clients)) await client.dispose()
			await server.dispose()
		},
		waitForIdle: async (idleOptions) => {
			const instances = toEntries(clients).flatMap(([, client]) => [
				...(client as InternalRealtimeTestClientBuilder).liveInstances,
			])
			await waitForClientsIdle(instances, server.journal, idleOptions)
		},
	}
}
