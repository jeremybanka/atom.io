import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { spawn as spawnChildProcess } from "node:child_process"

import type { ReadableFamilyToken } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import type { RootStore } from "atom.io/internal"
import {
	editRelationsInStore,
	findInStore,
	findRelationsInStore,
	getFromStore,
	getInternalRelationsFromStore,
	IMPLICIT,
	setIntoStore,
} from "atom.io/internal"
import type {
	AllEventsListener,
	Clock,
	EventsMap,
	GuardedSocket,
	RoomKey,
	RoomSocketInterface,
	Socket,
	SocketGuard,
	StandardSchemaV1,
	UserKey,
} from "atom.io/realtime"
import {
	guardSocket,
	isRoomKey,
	ownersOfRooms,
	roomKeysAtom,
	systemClock,
	usersInRooms,
	visibilityFromRoomSelectors,
	visibleUsersInRoomsSelectors,
} from "atom.io/realtime"

import { ChildSocket } from "./ipc-sockets/index.ts"
import { realtimeMutableFamilyProvider } from "./realtime-mutable-family-provider.ts"
import { realtimeMutableProvider } from "./realtime-mutable-provider.ts"

export type RoomMap = Map<
	string,
	ChildSocket<any, any, ChildProcessWithoutNullStreams>
>

declare global {
	var ATOM_IO_REALTIME_SERVER_ROOMS: RoomMap
}
export const ROOMS: RoomMap =
	globalThis.ATOM_IO_REALTIME_SERVER_ROOMS ??
	(globalThis.ATOM_IO_REALTIME_SERVER_ROOMS = new Map())

export const roomMeta: { count: number } = { count: 0 }

export type RoomTimeouts = {
	startupMs?: number | undefined
	idleMs?: number | undefined
	maximumMs?: number | undefined
	shutdownMs?: number | undefined
}

export const DEFAULT_ROOM_TIMEOUTS = {
	startupMs: 5_000,
	shutdownMs: 1_000,
} as const

type RoomLifecycle = {
	activeConnections: number
	child: ChildProcessWithoutNullStreams
	clock: Clock
	cleared: boolean
	connections: Set<(notifyRoom: boolean) => void>
	disposers: (() => void)[]
	idleMs: number | undefined
	idleTimer?: number
	maximumTimer?: number
	room: ChildSocket<any, any, ChildProcessWithoutNullStreams>
	roomKey: RoomKey
	shutdownMs: number
	shutdown?: Promise<void>
	store: RootStore
}

const ROOM_LIFECYCLES = new Map<RoomKey, RoomLifecycle>()

const waitForExit = (
	child: ChildProcessWithoutNullStreams,
	timeoutMs: number,
	clock: Clock,
): Promise<boolean> => {
	if (child.exitCode !== null || child.signalCode !== null)
		return Promise.resolve(true)
	return new Promise((resolve) => {
		let timeout: number
		const done = (): void => {
			clock.cancel(timeout)
			child.off(`exit`, exited)
			resolve(true)
		}
		const exited = (): void => {
			done()
		}
		timeout = clock.schedule(
			() => {
				child.off(`exit`, exited)
				resolve(false)
			},
			timeoutMs,
			`room process exit`,
		)
		child.once(`exit`, exited)
		if (child.exitCode !== null || child.signalCode !== null) done()
	})
}

const clearRoomState = (lifecycle: RoomLifecycle): void => {
	const { roomKey, store } = lifecycle
	if (lifecycle.cleared) return
	lifecycle.cleared = true
	if (lifecycle.idleTimer !== undefined)
		lifecycle.clock.cancel(lifecycle.idleTimer)
	if (lifecycle.maximumTimer !== undefined)
		lifecycle.clock.cancel(lifecycle.maximumTimer)
	for (const detach of [...lifecycle.connections]) detach(false)
	for (const dispose of lifecycle.disposers.splice(0)) dispose()
	lifecycle.room.dispose()
	ROOMS.delete(roomKey)
	ROOM_LIFECYCLES.delete(roomKey)
	// A child may exit after its owning realtime server has already disposed and
	// cleared the store. Global/process bookkeeping still has to finish, but the
	// room state no longer exists and must not be recreated or mutated.
	if (!store.atoms.has(roomKeysAtom.key)) return
	setIntoStore(store, roomKeysAtom, (keys) => (keys.delete(roomKey), keys))
	editRelationsInStore(store, usersInRooms, (relations) => {
		relations.delete({ room: roomKey })
	})
	editRelationsInStore(store, ownersOfRooms, (relations) => {
		relations.delete({ room: roomKey })
	})
}

const shutdownRoom = (
	lifecycle: RoomLifecycle,
	cause: string,
): Promise<void> => {
	lifecycle.shutdown ??= (async () => {
		const { child, clock, room, roomKey, shutdownMs, store } = lifecycle
		store.logger.info(`🔥`, `socket`, roomKey, `room shutdown`, cause)
		if (child.exitCode === null && child.signalCode === null) {
			room.emit(`exit`)
			if (!(await waitForExit(child, shutdownMs, clock))) {
				store.logger.warn(
					`🔥`,
					`socket`,
					roomKey,
					`escalating to SIGTERM`,
					cause,
				)
				child.kill(`SIGTERM`)
				if (!(await waitForExit(child, shutdownMs, clock))) {
					store.logger.error(
						`🔥`,
						`socket`,
						roomKey,
						`escalating to SIGKILL`,
						cause,
					)
					child.kill(`SIGKILL`)
					await waitForExit(child, shutdownMs, clock)
				}
			}
		}
		clearRoomState(lifecycle)
	})()
	return lifecycle.shutdown
}

const scheduleIdleShutdown = (lifecycle: RoomLifecycle): void => {
	if (lifecycle.idleTimer !== undefined)
		lifecycle.clock.cancel(lifecycle.idleTimer)
	if (
		lifecycle.cleared ||
		lifecycle.idleMs === undefined ||
		lifecycle.activeConnections > 0
	)
		return
	lifecycle.idleTimer = lifecycle.clock.schedule(
		() => {
			void shutdownRoom(lifecycle, `idle timeout`)
		},
		lifecycle.idleMs,
		`room ${lifecycle.roomKey} idle timeout`,
	)
}

const withTimeout = async <T>(
	value: Promise<T>,
	timeoutMs: number,
	message: string,
	clock: Clock,
): Promise<T> => {
	let timeout: number | undefined
	try {
		return await Promise.race([
			value,
			new Promise<never>((_, reject) => {
				timeout = clock.schedule(
					() => {
						reject(new Error(message))
					},
					timeoutMs,
					message,
				)
			}),
		])
	} finally {
		if (timeout !== undefined) clock.cancel(timeout)
	}
}

export type RoomProcessFactory = (
	command: string,
	args: readonly string[],
	roomKey: RoomKey,
) => ChildProcessWithoutNullStreams

export type SpawnRoomConfig<RoomNames extends string> = {
	clock?: Clock
	processFactory?: RoomProcessFactory
	store: RootStore
	socket: Socket
	userKey: UserKey
	resolveRoomScript: (roomName: RoomNames) => [string, string[]]
	timeouts?: RoomTimeouts
}
export function spawnRoom<RoomNames extends string>({
	clock = systemClock,
	processFactory = (command, args, roomKey) =>
		spawnChildProcess(command, [...args], {
			env: { ...process.env, REALTIME_ROOM_KEY: roomKey },
		}),
	store,
	socket,
	userKey,
	resolveRoomScript,
	timeouts = {},
}: SpawnRoomConfig<RoomNames>): (
	roomName: RoomNames,
) => Promise<ChildSocket<any, any>> {
	return async (roomName) => {
		store.logger.info(
			`📡`,
			`socket`,
			socket.id ?? `[ID MISSING?!]`,
			`👤 ${userKey} spawns room ${roomName}`,
		)
		const roomKey = `room::${roomMeta.count++}-${roomName}` satisfies RoomKey
		const [command, args] = resolveRoomScript(roomName)
		const child = processFactory(command, args, roomKey)
		const room = new ChildSocket(child, roomKey)
		const lifecycle: RoomLifecycle = {
			activeConnections: 0,
			child,
			cleared: false,
			clock,
			connections: new Set(),
			disposers: [],
			idleMs: timeouts.idleMs,
			room,
			roomKey,
			shutdownMs: timeouts.shutdownMs ?? DEFAULT_ROOM_TIMEOUTS.shutdownMs,
			store,
		}
		const startupFailed = (error: unknown): void => {
			startupFailure(error)
		}
		const exitedDuringStartup = (
			code: number | null,
			signal: NodeJS.Signals | null,
		): void => {
			startupFailure(
				new Error(
					`Room exited during startup (${code ?? signal ?? `unknown`}).`,
				),
			)
		}
		let startupFailure: (error: unknown) => void = () => undefined
		const failed = new Promise<never>((_, reject) => {
			startupFailure = reject
			child.once(`error`, startupFailed)
			child.once(`exit`, exitedDuringStartup)
		})
		try {
			await withTimeout(
				Promise.race([room.ready, failed]),
				timeouts.startupMs ?? DEFAULT_ROOM_TIMEOUTS.startupMs,
				`Room ${roomKey} did not become ready before its startup timeout.`,
				clock,
			)
		} catch (error) {
			child.off(`error`, startupFailed)
			child.off(`exit`, exitedDuringStartup)
			await shutdownRoom(lifecycle, `startup failed`)
			throw error
		}
		child.off(`error`, startupFailed)
		child.off(`exit`, exitedDuringStartup)

		ROOMS.set(roomKey, room)
		ROOM_LIFECYCLES.set(roomKey, lifecycle)
		setIntoStore(store, roomKeysAtom, (index) => (index.add(roomKey), index))
		editRelationsInStore(store, ownersOfRooms, (relations) => {
			relations.set({ room: roomKey, user: userKey })
		})

		const provideMutableFamily = realtimeMutableFamilyProvider({
			socket: room,
			consumer: roomKey,
			store,
		})

		const ownersOfRoomsAtoms = getInternalRelationsFromStore(
			store,
			ownersOfRooms,
		)
		const unsubFromOwnerKeys = provideMutableFamily(ownersOfRoomsAtoms, [
			roomKey,
		])
		const usersInRoomsAtoms = getInternalRelationsFromStore(store, usersInRooms)
		const unsubFromUsersInRooms = provideMutableFamily(
			usersInRoomsAtoms,
			findInStore(store, visibilityFromRoomSelectors, roomKey),
		)
		lifecycle.disposers.push(unsubFromOwnerKeys, unsubFromUsersInRooms)

		room.on(`close`, () => {
			void shutdownRoom(lifecycle, `child requested close`)
		})
		child.once(`exit`, () => {
			clearRoomState(lifecycle)
		})
		if (timeouts.maximumMs !== undefined) {
			lifecycle.maximumTimer = clock.schedule(
				() => {
					void shutdownRoom(lifecycle, `maximum lifetime`)
				},
				timeouts.maximumMs,
				`room ${roomKey} maximum lifetime`,
			)
		}
		scheduleIdleShutdown(lifecycle)

		return room
	}
}

export type ProvideEnterAndExitConfig = {
	store: RootStore
	socket: Socket
	roomSocket: GuardedSocket<RoomSocketInterface<string>>
	userKey: UserKey
}
export function provideEnterAndExit({
	store,
	socket,
	roomSocket,
	userKey,
}: ProvideEnterAndExitConfig): ((roomKey: RoomKey) => void) & {
	dispose: () => void
} {
	let detachCurrent: ((removeMembership: boolean) => void) | undefined
	const enterRoom = (roomKey: RoomKey): void => {
		detachCurrent?.(true)
		store.logger.info(
			`📡`,
			`socket`,
			socket.id ?? `[ID MISSING?!]`,
			`👤 ${userKey} enters ${roomKey}`,
		)
		const childSocket = ROOMS.get(roomKey)
		const lifecycle = ROOM_LIFECYCLES.get(roomKey)
		if (!childSocket || !lifecycle) {
			store.logger.error(`❌`, `unknown`, roomKey, `no room found with this id`)
			return
		}
		const toUser = socket.emit.bind(socket)
		childSocket.on(userKey, toUser)

		const roomQueue: [string, ...Json.Array][] = []
		const pushToRoomQueue = (payload: [string, ...Json.Array]): void => {
			roomQueue.push(payload)
		}
		let toRoom = pushToRoomQueue
		const forward: AllEventsListener<EventsMap> = (...payload) => {
			toRoom([userKey, ...payload])
		}
		socket.onAny(forward)

		let detached = false
		const dcUserFromRoom = (
			removeMembership = false,
			notifyRoom = true,
		): void => {
			if (detached) return
			detached = true
			store.logger.info(
				`📡`,
				`socket`,
				socket.id ?? `[ID MISSING?!]`,
				`👤 ${userKey} is has lost connection to ${roomKey}`,
			)
			socket.offAny(forward)
			childSocket.off(userKey, toUser)
			if (notifyRoom) toRoom([`user-leaves`, userKey])
			lifecycle.activeConnections = Math.max(0, lifecycle.activeConnections - 1)
			lifecycle.connections.delete(detachForRoomShutdown)
			scheduleIdleShutdown(lifecycle)
			if (removeMembership) {
				editRelationsInStore(store, usersInRooms, (relations) => {
					relations.delete({ room: roomKey, user: userKey })
				})
			}
			if (detachCurrent === dcUserFromRoom) detachCurrent = undefined
		}

		const detachForRoomShutdown = (notifyRoom: boolean): void => {
			dcUserFromRoom(false, notifyRoom)
		}

		const userIsAlreadyInRoom = getFromStore(
			store,
			getInternalRelationsFromStore(store, usersInRooms),
			roomKey,
		).has(userKey as any)

		if (!userIsAlreadyInRoom) {
			editRelationsInStore(store, usersInRooms, (relations) => {
				relations.set({ room: roomKey, user: userKey })
			})
		}
		childSocket.emit(`user-joins`, userKey)
		lifecycle.activeConnections++
		lifecycle.connections.add(detachForRoomShutdown)
		if (lifecycle.idleTimer) clearTimeout(lifecycle.idleTimer)

		toRoom = (payload) => {
			childSocket.emit(...payload)
		}
		while (roomQueue.length > 0) {
			const payload = roomQueue.shift()
			if (payload) toRoom(payload)
		}

		detachCurrent = dcUserFromRoom
	}
	roomSocket.on(`joinRoom`, enterRoom)
	const leaveRoom = (): void => detachCurrent?.(true)
	const disconnect = (): void => detachCurrent?.(false)
	roomSocket.on(`leaveRoom`, leaveRoom)
	socket.on(`disconnect`, disconnect)
	return Object.assign(enterRoom, {
		dispose: () => {
			detachCurrent?.(false)
			roomSocket.off(`joinRoom`, enterRoom)
			roomSocket.off(`leaveRoom`, leaveRoom)
			socket.off(`disconnect`, disconnect)
		},
	})
}

export type DestroyRoomConfig = {
	store: RootStore
	socket: Socket
	userKey: UserKey
}
export function destroyRoom({
	store,
	socket,
	userKey,
}: DestroyRoomConfig): (roomKey: RoomKey) => void {
	return (roomKey: RoomKey): void => {
		store.logger.info(
			`📡`,
			`socket`,
			socket.id ?? `[ID MISSING?!]`,
			`👤 ${userKey} attempts to delete ${roomKey}`,
		)
		const owner = getFromStore(
			store,
			findRelationsInStore(store, ownersOfRooms, roomKey).userKeyOfRoom,
		)
		if (owner === userKey) {
			store.logger.info(
				`📡`,
				`socket`,
				socket.id ?? `[ID MISSING?!]`,
				`👤 ${userKey} deletes ${roomKey}`,
			)
			setIntoStore(store, roomKeysAtom, (s) => (s.delete(roomKey), s))
			editRelationsInStore(store, usersInRooms, (relations) => {
				relations.delete({ room: roomKey })
			})
			const lifecycle = ROOM_LIFECYCLES.get(roomKey)
			if (lifecycle) void shutdownRoom(lifecycle, `owner deleted room`)
			return
		}
		store.logger.info(
			`📡`,
			`socket`,
			socket.id ?? `[ID MISSING?!]`,
			`👤 ${userKey} failed to delete ${roomKey}; its owner is ${owner}`,
		)
	}
}

export type ProvideRoomsConfig<RoomNames extends string> = {
	resolveRoomScript: (path: RoomNames) => [string, string[]]
	roomAdminsToken: ReadableFamilyToken<boolean, UserKey>
	roomNames: RoomNames[]
	roomTimeLimit?: number
	roomIdleTimeLimit?: number
	roomShutdownTimeLimit?: number
	roomStartupTimeLimit?: number
	userKey: UserKey
	store: RootStore
	socket: Socket
}
export function provideRooms<RoomNames extends string>({
	resolveRoomScript,
	roomAdminsToken,
	roomNames,
	socket,
	store = IMPLICIT.STORE,
	userKey,
	roomTimeLimit,
	roomIdleTimeLimit,
	roomShutdownTimeLimit,
	roomStartupTimeLimit,
}: ProvideRoomsConfig<RoomNames>): () => void {
	const isAdmin = getFromStore(store, roomAdminsToken, userKey)
	const roomSocket = guardSocket<RoomSocketInterface<RoomNames>>(
		socket,
		createRoomSocketGuard(roomNames),
	)
	const exposeMutable = realtimeMutableProvider({
		socket,
		store,
		consumer: userKey,
	})
	const unsubFromRoomKeys = exposeMutable(roomKeysAtom)
	const usersInRoomsAtoms = getInternalRelationsFromStore(store, usersInRooms)
	const [, usersInRoomsAtomsUsersOnly] = getInternalRelationsFromStore(
		store,
		usersInRooms,
		`split`,
	)
	const usersWhoseRoomsCanBeSeenSelector = findInStore(
		store,
		visibleUsersInRoomsSelectors,
		userKey,
	)
	const ownersOfRoomsAtoms = getInternalRelationsFromStore(store, ownersOfRooms)
	const exposeMutableFamily = realtimeMutableFamilyProvider({
		socket,
		store,
		consumer: userKey,
	})
	const unsubFromUsersInRooms = exposeMutableFamily(
		usersInRoomsAtoms,
		usersWhoseRoomsCanBeSeenSelector,
	)
	const unsubFromOwnersOfRooms = exposeMutableFamily(
		ownersOfRoomsAtoms,
		usersWhoseRoomsCanBeSeenSelector,
	)
	const enterRoom = provideEnterAndExit({
		store,
		socket,
		roomSocket,
		userKey,
	})

	const userRoomSet = getFromStore(store, usersInRoomsAtomsUsersOnly, userKey)
	for (const userRoomKey of userRoomSet) {
		enterRoom(userRoomKey)
		break
	}
	if (isAdmin) {
		const create = spawnRoom({
			store,
			socket,
			userKey,
			resolveRoomScript,
			timeouts: {
				startupMs: roomStartupTimeLimit,
				idleMs: roomIdleTimeLimit,
				maximumMs: roomTimeLimit,
				shutdownMs: roomShutdownTimeLimit,
			},
		})
		const createRoom = (roomName: RoomNames): void => {
			void create(roomName).catch((error: unknown) => {
				store.logger.error(
					`❌`,
					`socket`,
					socket.id ?? `unknown`,
					`room startup failed`,
					String(error),
				)
			})
		}
		const deleteRoom = destroyRoom({ store, socket, userKey })
		roomSocket.on(`createRoom`, createRoom)
		roomSocket.on(`deleteRoom`, deleteRoom)
		return () => {
			enterRoom.dispose()
			roomSocket.off(`createRoom`, createRoom)
			roomSocket.off(`deleteRoom`, deleteRoom)
			unsubFromRoomKeys()
			unsubFromUsersInRooms()
			unsubFromOwnersOfRooms()
		}
	}
	return () => {
		enterRoom.dispose()
		unsubFromRoomKeys()
		unsubFromUsersInRooms()
		unsubFromOwnersOfRooms()
	}
}

const roomKeySchema: StandardSchemaV1<Json.Array, [RoomKey]> = {
	"~standard": {
		version: 1,
		vendor: `atom.io`,
		validate: ([maybeRoomKey]: Json.Array) => {
			if (typeof maybeRoomKey === `string`) {
				if (isRoomKey(maybeRoomKey)) {
					return { value: [maybeRoomKey] }
				}
				return {
					issues: [
						{
							message: `Room key must start with "room::"`,
						},
					],
				}
			}
			return {
				issues: [
					{
						message: `Room key must be a string`,
					},
				],
			}
		},
	},
}

function createRoomSocketGuard<RoomNames extends string>(
	roomNames: RoomNames[],
): SocketGuard<RoomSocketInterface<RoomNames>> {
	return {
		createRoom: {
			"~standard": {
				version: 1,
				vendor: `atom.io`,
				validate: ([maybeRoomName]) => {
					if (roomNames.includes(maybeRoomName as RoomNames)) {
						return { value: [maybeRoomName as RoomNames] }
					}
					return {
						issues: [
							{
								message:
									`Room name must be one of the following:\n - ` +
									roomNames.join(`\n - `),
							},
						],
					}
				},
			},
		},
		joinRoom: roomKeySchema,
		deleteRoom: roomKeySchema,
		leaveRoom: {
			"~standard": {
				version: 1,
				vendor: `atom.io`,
				validate: () => ({ value: [] }),
			},
		},
	}
}
