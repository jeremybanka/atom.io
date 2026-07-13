import path from "node:path"

import { selectorFamily, type Silo } from "atom.io"
import type { UserKey } from "atom.io/realtime"
import * as RTS from "atom.io/realtime-server"
import type * as SocketIO from "socket.io"

function resolveRoomScript(name: string): [string, string[]] {
	const script = process.env[`ATOM_IO_TEST_ROOM_STARTUP_DELAY_MS`]
		? `delayed-game-instance.bun.ts`
		: name
	return [`bun`, [path.join(__dirname, script)]]
}
const isRoomAdminSelectors = selectorFamily<boolean, UserKey>({
	key: `isRoomAdmin`,
	get: () => () => true,
})
export const SystemServer = ({
	socket,
	silo: { store },
	enableLogging,
	userKey,
}: {
	socket: SocketIO.Socket
	silo: Silo
	enableLogging: () => void
	userKey: UserKey
}): void => {
	enableLogging()
	const cleanup = RTS.provideRooms({
		store,
		socket,
		userKey,
		resolveRoomScript,
		roomNames: [`game-instance.bun.ts`],
		roomAdminsToken: isRoomAdminSelectors,
	})
	socket.on(`disconnect`, cleanup)
}
