import path from "node:path"

import { Silo } from "atom.io"
import { getFromStore, IMPLICIT } from "atom.io/internal"
import type {
	GuardedSocket,
	RoomKey,
	RoomSocketInterface,
	UserKey,
} from "atom.io/realtime"
import { roomKeysAtom } from "atom.io/realtime"
import {
	destroyRoom,
	provideEnterAndExit,
	roomMeta,
	ROOMS,
	spawnRoom,
	SubjectSocket,
} from "atom.io/realtime-server"

const owner = `user::room-owner` as UserKey
const fixture = path.join(__dirname, `room-child-fixture.mjs`)

type TestEvents = Record<string, string[]>

const makeSocket = () => new SubjectSocket<TestEvents, TestEvents>(`test-socket`)

const setup = () => {
	const silo = new Silo(
		{ name: `room-lifecycle`, lifespan: `ephemeral`, isProduction: false },
		IMPLICIT.STORE,
	)
	const socket = makeSocket()
	return { silo, socket }
}

const spawnFixture = (
	mode: `crash` | `never-ready` | `normal` | `stubborn`,
	options: { idleMs?: number; maximumMs?: number } = {},
) => {
	const { silo, socket } = setup()
	const create = spawnRoom({
		store: silo.store,
		socket,
		userKey: owner,
		resolveRoomScript: () => [`bun`, [fixture, mode]],
		timeouts: {
			startupMs: 100,
			shutdownMs: 25,
			...options,
		},
	})
	return { create, silo, socket }
}

beforeEach(() => {
	roomMeta.count = 0
	ROOMS.clear()
})

afterEach(async () => {
	for (const room of ROOMS.values()) {
		room.proc.kill(`SIGKILL`)
	}
	await vi.waitFor(() => {
		expect(ROOMS.size).toBe(0)
	})
})

describe(`room lifecycle`, () => {
	test(`bounds failed startup and removes its child and room state`, async () => {
		const { create, silo } = spawnFixture(`never-ready`)
		await expect(create(`test`)).rejects.toThrow(`startup timeout`)
		expect(ROOMS.size).toBe(0)
		expect(getFromStore(silo.store, roomKeysAtom).size).toBe(0)
	})

	test(`joins, forwards, leaves, and removes every forwarding listener`, async () => {
		const { create, silo, socket } = spawnFixture(`normal`)
		const room = await create(`test`)
		const roomKey = room.key as RoomKey
		const roomSocket = socket as unknown as GuardedSocket<
			RoomSocketInterface<string>
		>
		const enter = provideEnterAndExit({
			store: silo.store,
			socket,
			roomSocket,
			userKey: owner,
		})
		const outgoing: unknown[] = []
		const unsubscribe = socket.out.subscribe(`test`, (event) => {
			outgoing.push(event)
		})

		enter(roomKey)
		socket.in.next([`move`, `A`])
		await vi.waitFor(() => {
			expect(outgoing).toContainEqual([`move`, `A`])
		})
		socket.in.next([`leaveRoom`])
		const countAfterLeave = outgoing.length
		socket.in.next([`move`, `B`])
		await new Promise((resolve) => setTimeout(resolve, 30))
		expect(outgoing).toHaveLength(countAfterLeave)

		enter.dispose()
		unsubscribe()
		destroyRoom({ store: silo.store, socket, userKey: owner })(roomKey)
		await vi.waitFor(() => {
			expect(ROOMS.has(roomKey)).toBe(false)
			expect(getFromStore(silo.store, roomKeysAtom).size).toBe(0)
		})
	})

	test(`enforces idle and maximum lifetime and escalates stubborn shutdown`, async () => {
		const idle = spawnFixture(`normal`, { idleMs: 20 })
		const idleRoom = await idle.create(`test`)
		await vi.waitFor(() => {
			expect(ROOMS.has(idleRoom.key)).toBe(false)
		})

		const maximum = spawnFixture(`stubborn`, { maximumMs: 20 })
		const maximumRoom = await maximum.create(`test`)
		await vi.waitFor(
			() => {
				expect(ROOMS.has(maximumRoom.key)).toBe(false)
			},
			{ timeout: 500 },
		)
		expect(
			(maximumRoom.proc as { signalCode?: NodeJS.Signals }).signalCode,
		).toBe(`SIGKILL`)
	})

	test(`cleans an orphaned room after a crash and permits a restart`, async () => {
		const crashed = spawnFixture(`crash`)
		const crashedRoom = await crashed.create(`test`)
		await vi.waitFor(() => {
			expect(ROOMS.has(crashedRoom.key)).toBe(false)
			expect(getFromStore(crashed.silo.store, roomKeysAtom).size).toBe(0)
		})

		const restarted = spawnFixture(`normal`)
		const restartedRoom = await restarted.create(`test`)
		expect(ROOMS.has(restartedRoom.key)).toBe(true)
		destroyRoom({
			store: restarted.silo.store,
			socket: restarted.socket,
			userKey: owner,
		})(restartedRoom.key as RoomKey)
		await vi.waitFor(() => {
			expect(ROOMS.has(restartedRoom.key)).toBe(false)
		})
	})
})
