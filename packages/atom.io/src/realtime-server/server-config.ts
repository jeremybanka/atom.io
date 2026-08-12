import type { IncomingHttpHeaders } from "node:http"
import type { ParsedUrlQuery } from "node:querystring"

import type { Loadable } from "atom.io"
import { Realm } from "atom.io/experiments/realms"
import type { RootStore } from "atom.io/internal"
import {
	editRelationsInStore,
	findInStore,
	IMPLICIT,
	setIntoStore,
} from "atom.io/internal"
import type { RoomKey, Socket, SocketKey, UserKey } from "atom.io/realtime"
import { myUserKeyAtom } from "atom.io/realtime-client"
import type { Server, Socket as IOSocket } from "socket.io"

import { realtimeStateProvider } from "./realtime-state-provider.ts"
import type { SocketSystemHierarchy } from "./server-socket-state.ts"
import {
	onlineUsersAtom,
	socketAtoms,
	socketKeysAtom,
	usersOfSockets,
} from "./server-socket-state.ts"

export type ServerConfig = {
	socket: Socket
	consumer: RoomKey | UserKey
	store?: RootStore
}
export type UserServerConfig = {
	socket: Socket
	consumer: UserKey
	store?: RootStore
}

/** Socket Handshake details--taken from socket.io */
export type Handshake = {
	/** The headers sent as part of the handshake */
	headers: IncomingHttpHeaders
	/** The date of creation (as string) */
	time: string
	/** The ip of the client */
	address: string
	/** Whether the connection is cross-domain */
	xdomain: boolean
	/** Whether the connection is secure */
	secure: boolean
	/** The date of creation (as unix timestamp) */
	issued: number
	/** The request URL string */
	url: string
	/** The query object */
	query: ParsedUrlQuery
	/** The auth object */
	auth: {
		[key: string]: any
	}
}

export function realtime(
	server: Server,
	auth: (handshake: Handshake) => Loadable<Error | UserKey>,
	onConnect: (config: UserServerConfig) => Loadable<() => Loadable<void>>,
	store: RootStore = IMPLICIT.STORE,
): () => Promise<void> {
	const socketRealm = new Realm<SocketSystemHierarchy>(store)
	const authenticatedUsers = new WeakMap<IOSocket, UserKey>()
	const identities = new Map<
		UserKey,
		{
			sockets: Set<SocketKey>
			claimAllocated: boolean
			indexed: boolean
		}
	>()
	const cleanupBySocket = new Map<SocketKey, () => Promise<void>>()

	const messageOf = (error: unknown): string =>
		error instanceof Error ? error.message : String(error)
	const reportFailure = (
		phase: `authenticate` | `connect` | `disconnect`,
		socketId: string,
		error: unknown,
	): void => {
		store.logger.error(
			`📡`,
			`socket`,
			socketId,
			`failed to ${phase}`,
			messageOf(error),
		)
	}

	server.use((socket, next) => {
		void Promise.resolve()
			.then(() => auth(socket.handshake))
			.then((result) => {
				if (result instanceof Error) {
					reportFailure(`authenticate`, socket.id, result)
					next(result)
					return
				}
				authenticatedUsers.set(socket, result)
				next()
			})
			.catch((error: unknown) => {
				reportFailure(`authenticate`, socket.id, error)
				next(
					error instanceof Error
						? error
						: new Error(`Authentication failed: ${String(error)}`),
				)
			})
	})

	server.on(`connection`, (socket) => {
		const userKey = authenticatedUsers.get(socket)
		authenticatedUsers.delete(socket)
		if (userKey === undefined) {
			reportFailure(
				`connect`,
				socket.id,
				new Error(`Authenticated identity was unavailable.`),
			)
			socket.disconnect(true)
			return
		}

		const socketKey = `socket::${socket.id}` satisfies SocketKey
		let socketClaimAllocated = false
		let relationCreated = false
		let socketIndexed = false
		let unsubFromMyUserKey: (() => void) | undefined
		let disposeServices: (() => Loadable<void>) | undefined
		let cleanupPromise: Promise<void> | undefined
		let resolveSetup: () => void = () => {}
		const setupSettled = new Promise<void>((resolve) => {
			resolveSetup = resolve
		})

		const safely = async (
			phase: `connect` | `disconnect`,
			operation: (() => Loadable<void>) | undefined,
		): Promise<void> => {
			if (operation === undefined) return
			try {
				await operation()
			} catch (error) {
				reportFailure(phase, socket.id, error)
			}
		}

		const cleanup = (): Promise<void> => {
			cleanupPromise ??= (async () => {
				await setupSettled
				store.logger.info(`📡`, `socket`, socketKey, `👤 ${userKey} disconnects`)
				await safely(`disconnect`, disposeServices)
				await safely(`disconnect`, unsubFromMyUserKey)

				if (relationCreated) {
					editRelationsInStore(store, usersOfSockets, (relations) => {
						relations.delete(socketKey)
					})
					relationCreated = false
				}
				if (socketIndexed) {
					setIntoStore(
						store,
						socketKeysAtom,
						(keys) => (keys.delete(socketKey), keys),
					)
					socketIndexed = false
				}
				if (socketClaimAllocated) {
					socketRealm.deallocate(socketKey)
					socketClaimAllocated = false
				}

				const identity = identities.get(userKey)
				identity?.sockets.delete(socketKey)
				if (identity?.sockets.size === 0) {
					identities.delete(userKey)
					if (identity.indexed) {
						setIntoStore(
							store,
							onlineUsersAtom,
							(keys) => (keys.delete(userKey), keys),
						)
						identity.indexed = false
					}
					if (identity.claimAllocated) {
						socketRealm.deallocate(userKey)
						identity.claimAllocated = false
					}
				}
				cleanupBySocket.delete(socketKey)
			})()
			return cleanupPromise
		}

		cleanupBySocket.set(socketKey, cleanup)
		socket.once(`disconnect`, () => {
			void cleanup()
		})

		void (async () => {
			try {
				let identity = identities.get(userKey)
				if (identity === undefined) {
					identity = {
						sockets: new Set(),
						claimAllocated: false,
						indexed: false,
					}
					identities.set(userKey, identity)
					socketRealm.allocate(`root`, userKey)
					identity.claimAllocated = true
					setIntoStore(store, onlineUsersAtom, (keys) => keys.add(userKey))
					identity.indexed = true
				}
				identity.sockets.add(socketKey)

				socketRealm.allocate(`root`, socketKey)
				socketClaimAllocated = true
				const socketState = findInStore(store, socketAtoms, socketKey)
				setIntoStore(store, socketState, socket)
				editRelationsInStore(store, usersOfSockets, (relations) => {
					relations.set(userKey, socketKey)
				})
				relationCreated = true
				setIntoStore(store, socketKeysAtom, (keys) => keys.add(socketKey))
				socketIndexed = true

				const serverConfig: UserServerConfig = {
					store,
					socket,
					consumer: userKey,
				}
				const provideState = realtimeStateProvider(serverConfig)
				unsubFromMyUserKey = provideState(myUserKeyAtom, userKey)
				disposeServices = await onConnect(serverConfig)
			} catch (error) {
				reportFailure(`connect`, socket.id, error)
				socket.disconnect(true)
			} finally {
				resolveSetup()
			}
		})()
	})

	let disposePromise: Promise<void> | undefined
	const disposeAll = (): Promise<void> => {
		disposePromise ??= (async () => {
			try {
				await server.close()
			} finally {
				await Promise.all(
					[...cleanupBySocket.values()].map((cleanup) => cleanup()),
				)
			}
		})()
		return disposePromise
	}
	return disposeAll
}
