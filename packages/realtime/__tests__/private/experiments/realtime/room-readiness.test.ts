import type { ChildProcessWithoutNullStreams } from "node:child_process"
import path from "node:path"

import type { RoomKey, UserKey } from "@atom.io/realtime"
import { roomKeysAtom } from "@atom.io/realtime"
import {
	destroyRoom,
	roomMeta,
	ROOMS,
	spawnRoom,
	SubjectSocket,
} from "@atom.io/realtime/server"
import { Silo } from "atom.io"
import { clearStore, getFromStore, IMPLICIT } from "atom.io/internal"

afterEach(async () => {
	for (const room of [...ROOMS.values()]) {
		const child = room.proc
		if (child.exitCode === null && child.signalCode === null) {
			const exited = new Promise<void>((resolve) => {
				child.once(`close`, () => {
					resolve()
				})
			})
			child.kill(`SIGKILL`)
			await exited
		}
		room.dispose()
	}
	vi.restoreAllMocks()
})

test(`room startup accepts split framed readiness followed by event data`, async () => {
	const info = vi.spyOn(console, `info`).mockImplementation(() => undefined)
	const silo = new Silo(
		{ name: `room-readiness`, lifespan: `ephemeral`, isProduction: false },
		IMPLICIT.STORE,
	)
	const socket = new SubjectSocket<Record<string, never>, Record<string, never>>(
		`room-readiness`,
	)
	const owner = `user::room-readiness` as UserKey
	const fixture = path.join(__dirname, `room-readiness-fixture.ts`)
	roomMeta.count = 0
	const create = spawnRoom({
		store: silo.store,
		socket,
		userKey: owner,
		resolveRoomScript: () => [`bun`, [fixture]],
	})

	const room = await create(`fixture`)
	expect(ROOMS.get(room.key)).toBe(room)
	expect(info).toHaveBeenCalledWith(
		expect.any(String),
		room.key,
		`💸`,
		`emitted`,
		[`boot`, `preserved`],
	)
	const exited = new Promise<void>((resolve) => {
		room.proc.stdout.once(`close`, resolve)
	})
	destroyRoom({ store: silo.store, socket, userKey: owner })(room.key as RoomKey)
	await exited
	ROOMS.clear()
})

for (const mode of [`normal`, `stubborn`] as const) {
	test(`real room ${mode === `normal` ? `exits gracefully` : `survives SIGTERM and requires SIGKILL`} and clears room state`, async () => {
		const silo = new Silo(
			{ name: `room-${mode}`, lifespan: `ephemeral`, isProduction: false },
			IMPLICIT.STORE,
		)
		const socket = new SubjectSocket<
			Record<string, never>,
			Record<string, never>
		>(`room-${mode}`)
		const owner = `user::room-${mode}` as UserKey
		const create = spawnRoom({
			store: silo.store,
			socket,
			userKey: owner,
			resolveRoomScript: () => [
				`bun`,
				[path.join(__dirname, `room-child-fixture.ts`), mode],
			],
			timeouts: { startupMs: 15_000, shutdownMs: 1_000 },
		})
		const room = await create(mode)
		const child = room.proc as ChildProcessWithoutNullStreams
		const kill = vi.spyOn(child, `kill`)
		const closed = new Promise<void>((resolve) => {
			child.once(`close`, () => {
				resolve()
			})
		})
		try {
			expect(ROOMS.has(room.key as RoomKey)).toBe(true)
			expect(
				getFromStore(silo.store, roomKeysAtom).has(room.key as RoomKey),
			).toBe(true)
			destroyRoom({ store: silo.store, socket, userKey: owner })(
				room.key as RoomKey,
			)
			await closed
			if (mode === `normal`) {
				expect(child.exitCode).toBe(0)
				expect(child.signalCode).toBeNull()
				expect(kill).not.toHaveBeenCalled()
			} else {
				expect(kill.mock.calls.map(([signal]) => signal)).toEqual([
					`SIGTERM`,
					`SIGKILL`,
				])
				expect(child.signalCode).toBe(`SIGKILL`)
			}
			expect(ROOMS.has(room.key as RoomKey)).toBe(false)
			expect(
				getFromStore(silo.store, roomKeysAtom).has(room.key as RoomKey),
			).toBe(false)
		} finally {
			if (child.exitCode === null && child.signalCode === null)
				child.kill(`SIGKILL`)
			await closed
			clearStore(silo.store)
		}
	}, 25_000)
}
