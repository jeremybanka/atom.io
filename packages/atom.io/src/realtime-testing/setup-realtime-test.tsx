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

import { RealtimeTestInspectors } from "./diagnostics.ts"
import {
	type RealtimeTestEventCursor,
	RealtimeTestEventJournal,
} from "./event-journal.ts"
import {
	type RealtimeTestDrainContext,
	RealtimeTestWorkTracker,
} from "./work-tracker.ts"

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
	/** Register selected server state to include in timeout diagnostics. */
	inspect: (label: string, read: () => unknown) => () => void
	/** Track or drain application work that transport barriers cannot observe. */
	work: RealtimeTestWorkTracker
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
	/** Drain registered client application work without touching transport queues. */
	drainApplication: (options?: WaitOptions) => Promise<void>
	/**
	 * Explicitly drain messages ordered before a bidirectional transport barrier.
	 * Socket.IO cannot retract a packet after timeout; the harness removes its
	 * waiter and safely ignores any response that arrives later.
	 */
	drainTransport: (options?: WaitForIdleOptions) => Promise<void>
	dispose: () => Promise<void>
	enableLogging: () => void
	/** Register selected client state to include in timeout diagnostics. */
	inspect: (label: string, read: () => unknown) => () => void
	journal: RealtimeTestEventJournal
	sessionId: string
	socket: ClientSocket
	userKey: RT.UserKey
	/**
	 * Wait until all transport work ordered before a bidirectional barrier has run.
	 * Timed work scheduled by application code is deliberately outside this contract.
	 */
	waitForIdle: (options?: WaitForIdleOptions) => Promise<void>
	/** Track or drain application work that transport barriers cannot observe. */
	work: RealtimeTestWorkTracker
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

export type WaitOptions = {
	/** Maximum wall-clock wait. Defaults to 1,000 milliseconds. */
	timeout?: number
}

export type WaitForIdleOptions = WaitOptions & {
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
	inspect: (label: string, read: () => unknown) => () => void
	journal: RealtimeTestEventJournal
	port: number
	work: RealtimeTestWorkTracker
}

/** One selected participant in a convergence barrier. */
export type RealtimeTestConvergenceParticipant<State> = {
	label: string
	read: () => State
}

export type WaitForConvergenceOptions<State> = WaitForIdleOptions & {
	/** Compare states after application and transport queues have drained. */
	equals?: (left: State, right: State) => boolean
	participants: readonly RealtimeTestConvergenceParticipant<State>[]
}

export type RealtimeTestAPI = {
	/** Drain registered application work on the server and all live clients. */
	drainApplication: (options?: WaitOptions) => Promise<void>
	/** Drain transport queues for every live client. */
	drainTransport: (options?: WaitForIdleOptions) => Promise<void>
	server: RealtimeTestServer
	teardown: () => Promise<void>
	waitForIdle: (options?: WaitForIdleOptions) => Promise<void>
	/** Repeatedly drain all work and compare selected participant state. */
	waitForConvergence: <State>(
		options: WaitForConvergenceOptions<State>,
	) => Promise<State>
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
	clients: ReadonlySet<HeadlessRealtimeTestClient>
	diagnostics: () => string
	registerClient: (client: HeadlessRealtimeTestClient) => void
	unregisterClient: (client: HeadlessRealtimeTestClient) => void
}

type InternalRealtimeTestClient = HeadlessRealtimeTestClient & {
	diagnostics: () => string
}

type InternalRealtimeTestClientBuilder = RealtimeTestClientBuilder & {
	liveInstances: ReadonlySet<RealtimeTestClient>
}

const timeoutError = (
	message: string,
	server: InternalRealtimeTestServer,
): Error =>
	new Error(
		`${message}\n\nSelected state:\n${server.diagnostics()}\n\nEvent journal:\n${server.journal.transcript({ limit: 30 })}`,
	)

const withTimeout = async <T,>(
	operation: (signal: AbortSignal) => Promise<T>,
	timeout: number,
	onTimeout: () => Error,
): Promise<T> => {
	const controller = new AbortController()
	let timer!: ReturnType<typeof setTimeout>
	const expired = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			const error = onTimeout()
			controller.abort(error)
			reject(error)
		}, timeout)
	})
	try {
		return await Promise.race([operation(controller.signal), expired])
	} finally {
		clearTimeout(timer)
		controller.abort(new Error(`Realtime test wait completed`))
	}
}

const remaining = (started: number, timeout: number): number =>
	timeout - (Date.now() - started)

const applicationTrackers = (
	clients: Iterable<HeadlessRealtimeTestClient>,
	server: InternalRealtimeTestServer,
): RealtimeTestWorkTracker[] => [
	server.work,
	...[...clients].map(({ work }) => work),
]

const drainApplicationWork = async (
	trackers: Iterable<RealtimeTestWorkTracker>,
	server: InternalRealtimeTestServer,
	options: WaitOptions = {},
): Promise<void> => {
	const timeout = options.timeout ?? 1_000
	const started = Date.now()
	await withTimeout(
		async (signal) => {
			const context: RealtimeTestDrainContext = {
				deadline: started + timeout,
				now: Date.now,
				signal,
			}
			for (const tracker of trackers) await tracker.drain(context)
		},
		timeout,
		() => timeoutError(`Timed out draining realtime application work`, server),
	)
}

const drainClientsTransport = async (
	clients: Iterable<HeadlessRealtimeTestClient>,
	server: InternalRealtimeTestServer,
	options: WaitForIdleOptions = {},
): Promise<void> => {
	const timeout = options.timeout ?? 1_000
	const stableRounds = options.stableRounds ?? 2
	if (!Number.isInteger(stableRounds) || stableRounds < 1) {
		throw new Error(`stableRounds must be a positive integer`)
	}
	const started = Date.now()
	let stable = 0
	let previousCursor = server.journal.cursor()
	while (stable < stableRounds) {
		for (const client of clients) {
			const timeLeft = remaining(started, timeout)
			if (timeLeft <= 0) {
				throw timeoutError(
					`Timed out draining realtime transport queues`,
					server,
				)
			}
			await client.drainTransport({ timeout: timeLeft, stableRounds: 1 })
		}
		const cursor = server.journal.cursor()
		stable = cursor === previousCursor ? stable + 1 : 0
		previousCursor = cursor
	}
}

const waitForClientsIdle = async (
	clients: Iterable<HeadlessRealtimeTestClient>,
	server: InternalRealtimeTestServer,
	options: WaitForIdleOptions = {},
): Promise<void> => {
	const selectedClients = [...clients]
	const timeout = options.timeout ?? 1_000
	const stableRounds = options.stableRounds ?? 2
	const started = Date.now()
	let stable = 0
	let previousCursor = server.journal.cursor()
	while (stable < stableRounds) {
		const timeLeft = remaining(started, timeout)
		if (timeLeft <= 0) {
			throw timeoutError(
				`Timed out waiting for the realtime scenario to become idle`,
				server,
			)
		}
		await drainApplicationWork(
			applicationTrackers(selectedClients, server),
			server,
			{ timeout: timeLeft },
		)
		await drainClientsTransport(selectedClients, server, {
			stableRounds: 1,
			timeout: remaining(started, timeout),
		})
		const cursor = server.journal.cursor()
		const pending = applicationTrackers(selectedClients, server).flatMap(
			(tracker) => tracker.pendingLabels(),
		)
		stable = cursor === previousCursor && pending.length === 0 ? stable + 1 : 0
		previousCursor = cursor
	}
}

const stringifyDiagnostic = (value: unknown): string => {
	try {
		return JSON.stringify(value)
	} catch {
		return `[unserializable]`
	}
}

const defaultEquals = (left: unknown, right: unknown): boolean => {
	if (Object.is(left, right)) return true
	try {
		return JSON.stringify(left) === JSON.stringify(right)
	} catch {
		return false
	}
}

const waitForConvergence = async <State,>(
	clients: Iterable<HeadlessRealtimeTestClient>,
	server: InternalRealtimeTestServer,
	options: WaitForConvergenceOptions<State>,
): Promise<State> => {
	if (options.participants.length === 0) {
		throw new Error(`A convergence barrier requires at least one participant`)
	}
	const timeout = options.timeout ?? 1_000
	const stableRounds = options.stableRounds ?? 2
	const equals = options.equals ?? defaultEquals
	const started = Date.now()
	let stable = 0
	let lastStates: State[] = []
	const convergenceTimeout = (cause?: unknown) => {
		const selected = options.participants
			.map(({ label, read }) => `${label}: ${stringifyDiagnostic(read())}`)
			.join(`\n`)
		const causeMessage =
			cause instanceof Error ? `\nLast barrier error: ${cause.message}` : ``
		return timeoutError(
			`Timed out waiting for realtime convergence.\nObserved participants:\n${selected}${causeMessage}`,
			server,
		)
	}
	while (stable < stableRounds) {
		const timeLeft = remaining(started, timeout)
		if (timeLeft <= 0) throw convergenceTimeout()
		try {
			await waitForClientsIdle(clients, server, {
				stableRounds: 1,
				timeout: timeLeft,
			})
		} catch (error) {
			throw convergenceTimeout(error)
		}
		lastStates = options.participants.map(({ read }) => read())
		const first = lastStates[0]!
		if (lastStates.every((state) => equals(first, state))) stable++
		else stable = 0
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
	}
	return lastStates[0]!
}

export const setupRealtimeTestServer = (
	options: TestSetupOptions,
): RealtimeTestServer => {
	++testNumber
	let readDiagnostics = () => `[realtime server is initializing]`
	const journal = new RealtimeTestEventJournal({
		diagnostics: () => readDiagnostics(),
	})
	const clients = new Set<HeadlessRealtimeTestClient>()
	const inspectors = new RealtimeTestInspectors()
	const work = new RealtimeTestWorkTracker()
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
			socket.on(BARRIER_REQUEST, (nonce: string) => {
				socket.emit(BARRIER_RESPONSE, nonce)
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
			const connectionInspectors: (() => void)[] = []
			const disposeServices = options.server({
				socket,
				userKey,
				sessionId,
				enableLogging,
				inspect: (label, read) => {
					const dispose = inspectors.register(
						`server/${sessionId}/${label}`,
						read,
					)
					connectionInspectors.push(dispose)
					return dispose
				},
				silo,
				work,
			})
			return () => {
				disposeServices?.()
				for (const disposeInspector of connectionInspectors) disposeInspector()
			}
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
		clients,
		diagnostics: () =>
			[
				inspectors.transcript(),
				work.pendingLabels().length === 0
					? `server pending work: []`
					: `server pending work: ${JSON.stringify(work.pendingLabels())}`,
				...[...clients].map(
					(client) =>
						`${client.name}/${client.sessionId}:\n${(client as InternalRealtimeTestClient).diagnostics()}`,
				),
			].join(`\n`),
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
		inspect: (label, read) => inspectors.register(`server/${label}`, read),
		silo,
		unregisterClient: (client) => clients.delete(client),
		work,
	}
	readDiagnostics = result.diagnostics
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
	const inspectors = new RealtimeTestInspectors()
	const work = new RealtimeTestWorkTracker()
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
	const barrierWaiters = new Map<string, () => void>()
	socket.on(BARRIER_RESPONSE, (nonce: string) => {
		const resolve = barrierWaiters.get(nonce)
		if (!resolve) return
		barrierWaiters.delete(nonce)
		resolve()
	})

	let disposed = false
	let barrierNumber = 0
	const client: InternalRealtimeTestClient = {
		diagnostics: () =>
			[
				inspectors.transcript(),
				`connected: ${String(socket.connected)}`,
				`pending barriers: ${JSON.stringify([...barrierWaiters.keys()])}`,
				`pending work: ${JSON.stringify(work.pendingLabels())}`,
			].join(`\n`),
		drainApplication: async (drainOptions) => {
			await drainApplicationWork([work], server, drainOptions)
		},
		drainTransport: async ({ timeout = 1_000, stableRounds = 2 } = {}) => {
			if (disposed)
				throw new Error(`Realtime test client ${sessionId} is disposed`)
			if (!Number.isInteger(stableRounds) || stableRounds < 1) {
				throw new Error(`stableRounds must be a positive integer`)
			}
			if (!socket.connected) {
				await withTimeout(
					(signal) =>
						new Promise<void>((resolve, reject) => {
							const cleanup = () => {
								socket.off(`connect`, onConnect)
								socket.off(`connect_error`, onConnectError)
								signal.removeEventListener(`abort`, cleanup)
							}
							const onConnect = () => {
								cleanup()
								resolve()
							}
							const onConnectError = (error: Error) => {
								cleanup()
								reject(error)
							}
							signal.addEventListener(`abort`, cleanup, { once: true })
							socket.on(`connect`, onConnect)
							socket.on(`connect_error`, onConnectError)
						}),
					timeout,
					() =>
						timeoutError(
							`Timed out waiting for ${sessionId} to connect`,
							server,
						),
				)
			}
			const started = Date.now()
			let stable = 0
			let previousCursor = server.journal.cursor()
			while (stable < stableRounds) {
				const timeLeft = remaining(started, timeout)
				if (timeLeft <= 0) {
					throw timeoutError(
						`Timed out draining the ${sessionId} transport queue`,
						server,
					)
				}
				const nonce = `${sessionId}:${++barrierNumber}`
				await withTimeout(
					(signal) =>
						new Promise<void>((resolve) => {
							const cleanup = () => {
								barrierWaiters.delete(nonce)
								signal.removeEventListener(`abort`, cleanup)
							}
							barrierWaiters.set(nonce, () => {
								cleanup()
								resolve()
							})
							signal.addEventListener(`abort`, cleanup, { once: true })
							socket.emit(BARRIER_REQUEST, nonce)
						}),
					timeLeft,
					() =>
						timeoutError(
							`Timed out waiting for the ${sessionId} transport barrier. Socket.IO cannot retract an emitted packet; its late response will be ignored.`,
							server,
						),
				)
				await Promise.resolve()
				const cursor = server.journal.cursor()
				stable = cursor === previousCursor ? stable + 1 : 0
				previousCursor = cursor
			}
		},
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
		inspect: (label, read) =>
			inspectors.register(`${options.name}/${sessionId}/${label}`, read),
		journal: server.journal,
		name: options.name,
		sessionId,
		silo,
		socket,
		userKey,
		waitForIdle: async (idleOptions) => {
			await waitForClientsIdle([client], server, idleOptions)
		},
		work,
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
		drainApplication: async (drainOptions) => {
			await drainApplicationWork(
				applicationTrackers(clients, server),
				server,
				drainOptions,
			)
		},
		drainTransport: async (idleOptions) => {
			await drainClientsTransport(clients, server, idleOptions)
		},
		server,
		teardown: async () => {
			await Promise.all([...clients].map((client) => client.dispose()))
			await server.dispose()
		},
		waitForIdle: async (idleOptions) => {
			await waitForClientsIdle(clients, server, idleOptions)
		},
		waitForConvergence: async (convergenceOptions) =>
			waitForConvergence(clients, server, convergenceOptions),
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
			await waitForClientsIdle(instances, internalServer, idleOptions)
		},
	}
	return builder
}

export const singleClient = (
	options: TestSetupOptions__SingleClient,
): RealtimeTestAPI__SingleClient => {
	const server = setupRealtimeTestServer(options)
	const client = setupRealtimeTestClient(options, `CLIENT`, server)
	const internalServer = server as InternalRealtimeTestServer
	const getClients = () =>
		(client as InternalRealtimeTestClientBuilder).liveInstances
	return {
		client,
		drainApplication: async (drainOptions) => {
			await drainApplicationWork(
				applicationTrackers(getClients(), internalServer),
				internalServer,
				drainOptions,
			)
		},
		drainTransport: async (idleOptions) => {
			await drainClientsTransport(getClients(), internalServer, idleOptions)
		},
		server,
		teardown: async () => {
			await client.dispose()
			await server.dispose()
		},
		waitForIdle: async (idleOptions) => {
			await waitForClientsIdle(getClients(), internalServer, idleOptions)
		},
		waitForConvergence: async (convergenceOptions) =>
			waitForConvergence(getClients(), internalServer, convergenceOptions),
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
	const internalServer = server as InternalRealtimeTestServer
	const getInstances = () =>
		toEntries(clients).flatMap(([, client]) => [
			...(client as InternalRealtimeTestClientBuilder).liveInstances,
		])
	return {
		clients,
		drainApplication: async (drainOptions) => {
			await drainApplicationWork(
				applicationTrackers(getInstances(), internalServer),
				internalServer,
				drainOptions,
			)
		},
		drainTransport: async (idleOptions) => {
			await drainClientsTransport(getInstances(), internalServer, idleOptions)
		},
		server,
		teardown: async () => {
			for (const [, client] of toEntries(clients)) await client.dispose()
			await server.dispose()
		},
		waitForIdle: async (idleOptions) => {
			await waitForClientsIdle(getInstances(), internalServer, idleOptions)
		},
		waitForConvergence: async (convergenceOptions) =>
			waitForConvergence(getInstances(), internalServer, convergenceOptions),
	}
}
