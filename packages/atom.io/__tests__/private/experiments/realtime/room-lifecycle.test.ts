import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"

import { Silo } from "atom.io"
import { clearStore, getFromStore, IMPLICIT } from "atom.io/internal"
import type {
	GuardedSocket,
	RoomKey,
	RoomSocketInterface,
	UserKey,
} from "atom.io/realtime"
import { roomKeysAtom } from "atom.io/realtime"
import {
	destroyRoom,
	encodeJsonFrame,
	provideEnterAndExit,
	roomMeta,
	ROOMS,
	spawnRoom,
	SubjectSocket,
} from "atom.io/realtime-server"
import { VirtualClock } from "atom.io/realtime-testing/headless"

const owner = `user::room-owner` as UserKey

type TestEvents = Record<string, string[]>
type FixtureMode = `crash` | `never-ready` | `normal` | `stubborn`
type TestProcess = ChildProcessWithoutNullStreams & {
	readonly signals: NodeJS.Signals[]
}

const makeSocket = () => new SubjectSocket<TestEvents, TestEvents>(`test-socket`)

const setup = () => {
	const silo = new Silo(
		{ name: `room-lifecycle`, lifespan: `ephemeral`, isProduction: false },
		IMPLICIT.STORE,
	)
	const socket = makeSocket()
	return { silo, socket }
}

const createTestProcess = (
	mode: FixtureMode,
	clock: VirtualClock,
): TestProcess => {
	const events = new EventEmitter()
	const stdin = new PassThrough()
	const stdout = new PassThrough()
	const stderr = new PassThrough()
	const signals: NodeJS.Signals[] = []
	let exitCode: number | null = null
	let signalCode: NodeJS.Signals | null = null
	let pending = ``

	const child = Object.assign(events, {
		kill: (signal: NodeJS.Signals = `SIGTERM`) => {
			signals.push(signal)
			if (mode !== `stubborn` || signal === `SIGKILL`) exit(null, signal)
			return true
		},
		pid: 1,
		signals,
		stderr,
		stdin,
		stdout,
	}) as unknown as TestProcess
	Object.defineProperties(child, {
		exitCode: { get: () => exitCode },
		signalCode: { get: () => signalCode },
	})

	const exit = (code: number | null, signal: NodeJS.Signals | null): void => {
		if (exitCode !== null || signalCode !== null) return
		exitCode = code
		signalCode = signal
		child.emit(`exit`, code, signal)
		stdout.end()
		stderr.end()
	}

	stdin.setEncoding(`utf8`)
	stdin.on(`data`, (chunk: string) => {
		pending += chunk
		let boundary = pending.indexOf(`\x03`)
		while (boundary !== -1) {
			const frame = pending.slice(0, boundary)
			pending = pending.slice(boundary + 1)
			const [event, ...args] = JSON.parse(frame) as string[]
			if (event === `exit`) {
				if (mode !== `stubborn`) exit(0, null)
			} else if (event.startsWith(`user::`)) {
				stdout.write(encodeJsonFrame([event, ...args]))
			}
			boundary = pending.indexOf(`\x03`)
		}
	})

	if (mode !== `never-ready`) {
		clock.schedule(
			() => {
				stdout.write(encodeJsonFrame(`ALIVE`))
				stdout.write(encodeJsonFrame([`boot`, mode]))
			},
			0,
			`test room process ready`,
		)
	}
	if (mode === `crash`) {
		clock.schedule(
			() => {
				exit(1, null)
			},
			25,
			`test room process crash`,
		)
	}
	return child
}

const settle = async (): Promise<void> => {
	await Promise.resolve()
	await Promise.resolve()
}

const advance = async (clock: VirtualClock, milliseconds: number) => {
	clock.advance(milliseconds)
	await settle()
}

const spawnFixture = (
	mode: FixtureMode,
	options: { idleMs?: number; maximumMs?: number } = {},
) => {
	const { silo, socket } = setup()
	const clock = new VirtualClock()
	let child: TestProcess | undefined
	const create = spawnRoom({
		clock,
		processFactory: () => (child = createTestProcess(mode, clock)),
		store: silo.store,
		socket,
		userKey: owner,
		resolveRoomScript: () => [`test-room`, [mode]],
		timeouts: {
			startupMs: 100,
			shutdownMs: 25,
			...options,
		},
	})
	return { child: () => child!, clock, create, silo, socket }
}

const createReadyRoom = async (fixture: ReturnType<typeof spawnFixture>) => {
	const creating = fixture.create(`test`)
	await advance(fixture.clock, 0)
	const room = await creating
	await settle()
	return room
}

beforeEach(() => {
	vi.stubGlobal(`window`, undefined)
	roomMeta.count = 0
	ROOMS.clear()
})

afterEach(() => {
	for (const room of ROOMS.values()) room.proc.kill(`SIGKILL`)
	expect(ROOMS.size).toBe(0)
	vi.unstubAllGlobals()
})

describe(`room lifecycle`, () => {
	test(`bounds failed startup and removes its child and room state`, async () => {
		const fixture = spawnFixture(`never-ready`)
		const creating = fixture.create(`test`)
		await advance(fixture.clock, 100)
		await expect(creating).rejects.toThrow(`startup timeout`)
		expect(ROOMS.size).toBe(0)
		expect(getFromStore(fixture.silo.store, roomKeysAtom).size).toBe(0)
		expect(fixture.clock.pending()).toEqual([])
	})

	test(`joins, forwards, leaves, and removes every forwarding listener`, async () => {
		const fixture = spawnFixture(`normal`)
		const room = await createReadyRoom(fixture)
		const roomKey = room.key as RoomKey
		const roomSocket = fixture.socket as unknown as GuardedSocket<
			RoomSocketInterface<string>
		>
		const enter = provideEnterAndExit({
			store: fixture.silo.store,
			socket: fixture.socket,
			roomSocket,
			userKey: owner,
		})
		const outgoing: unknown[] = []
		const unsubscribe = fixture.socket.out.subscribe(`test`, (event) => {
			outgoing.push(event)
		})

		enter(roomKey)
		fixture.socket.in.next([`move`, `A`])
		expect(outgoing).toContainEqual([`move`, `A`])
		fixture.socket.in.next([`leaveRoom`])
		const countAfterLeave = outgoing.length
		fixture.socket.in.next([`move`, `B`])
		expect(outgoing).toHaveLength(countAfterLeave)

		enter.dispose()
		unsubscribe()
		destroyRoom({
			store: fixture.silo.store,
			socket: fixture.socket,
			userKey: owner,
		})(roomKey)
		await settle()
		expect(ROOMS.has(roomKey)).toBe(false)
		expect(getFromStore(fixture.silo.store, roomKeysAtom).size).toBe(0)
	})

	test(`enforces idle and maximum lifetime and escalates stubborn shutdown`, async () => {
		const idle = spawnFixture(`normal`, { idleMs: 20 })
		const idleRoom = await createReadyRoom(idle)
		await advance(idle.clock, 20)
		expect(ROOMS.has(idleRoom.key)).toBe(false)

		const maximum = spawnFixture(`stubborn`, { maximumMs: 20 })
		const maximumRoom = await createReadyRoom(maximum)
		await advance(maximum.clock, 20)
		await advance(maximum.clock, 25)
		await advance(maximum.clock, 25)
		expect(ROOMS.has(maximumRoom.key)).toBe(false)
		expect(maximum.child().signals).toEqual([`SIGTERM`, `SIGKILL`])
	})

	test(`cleans an orphaned room after a crash and permits a restart`, async () => {
		const crashed = spawnFixture(`crash`)
		const crashedRoom = await createReadyRoom(crashed)
		await advance(crashed.clock, 25)
		expect(ROOMS.has(crashedRoom.key)).toBe(false)
		expect(getFromStore(crashed.silo.store, roomKeysAtom).size).toBe(0)

		const restarted = spawnFixture(`normal`)
		const restartedRoom = await createReadyRoom(restarted)
		expect(ROOMS.has(restartedRoom.key)).toBe(true)
		destroyRoom({
			store: restarted.silo.store,
			socket: restarted.socket,
			userKey: owner,
		})(restartedRoom.key as RoomKey)
		await settle()
		expect(ROOMS.has(restartedRoom.key)).toBe(false)
	})

	test(`finishes child cleanup after the owning store is disposed`, async () => {
		const server = spawnFixture(`normal`)
		const room = await createReadyRoom(server)
		expect(ROOMS.has(room.key)).toBe(true)

		clearStore(server.silo.store)
		server.child().kill(`SIGKILL`)
		await settle()

		expect(ROOMS.has(room.key)).toBe(false)
		expect(server.silo.store.atoms.has(roomKeysAtom.key)).toBe(false)
	})
})
