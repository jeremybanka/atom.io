import path from "node:path"

import { Silo } from "atom.io"
import { IMPLICIT } from "atom.io/internal"
import type { RoomKey, UserKey } from "atom.io/realtime"
import {
	destroyRoom,
	roomMeta,
	ROOMS,
	spawnRoom,
	SubjectSocket,
} from "atom.io/realtime-server"

test(`room startup accepts a split proof-of-life signal`, async () => {
	const silo = new Silo(
		{ name: `room-readiness`, lifespan: `ephemeral`, isProduction: false },
		IMPLICIT.STORE,
	)
	const socket = new SubjectSocket<Record<string, never>, Record<string, never>>(
		`room-readiness`,
	)
	const owner = `user::room-readiness` as UserKey
	const fixture = path.join(__dirname, `room-readiness-fixture.mjs`)
	roomMeta.count = 0
	const create = spawnRoom({
		store: silo.store,
		socket,
		userKey: owner,
		resolveRoomScript: () => [`bun`, [fixture]],
	})

	const room = await create(`fixture`)
	expect(ROOMS.get(room.key)).toBe(room)
	const exited = new Promise<void>((resolve) => {
		room.proc.stdout.once(`close`, resolve)
	})
	destroyRoom({ store: silo.store, socket, userKey: owner })(room.key as RoomKey)
	await exited
	ROOMS.clear()
})
