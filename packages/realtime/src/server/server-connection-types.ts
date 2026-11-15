import type { RoomKey, Socket, UserKey } from "@atom.io/realtime"
import type { RootStore } from "atom.io/internal"

/** Runtime-neutral service configuration shared by Node and Workers hosts. */
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
