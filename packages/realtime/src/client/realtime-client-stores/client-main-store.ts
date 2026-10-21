import type { RoomKey, UserKey } from "@atom.io/realtime"
import { myUserKeyAtom, ownersOfRooms, usersInRooms } from "@atom.io/realtime"
import type { ReadonlyPureSelectorToken, ViewOf } from "atom.io"
import { getInternalRelations, selector } from "atom.io"
import type { UList } from "atom.io/transceivers/u-list"

export { mySocketKeyAtom, myUserKeyAtom } from "@atom.io/realtime"

export const myRoomKeySelector: ReadonlyPureSelectorToken<RoomKey | null> =
	selector({
		key: `myRoomKey`,
		get: ({ get }) => {
			if (
				`process` in globalThis &&
				`env` in process &&
				`REALTIME_ROOM_KEY` in process.env
			) {
				// if a room running server-side wants its own key, this is where it lives
				return process.env[`REALTIME_ROOM_KEY`] as RoomKey
			}
			const myUserKey = get(myUserKeyAtom)
			if (!myUserKey) return null
			const [, usersInRoomsAtoms] = getInternalRelations(usersInRooms, `split`)
			const roomKeys = get(usersInRoomsAtoms, myUserKey)
			for (const roomKey of roomKeys) return roomKey
			return null
		},
	})

export const usersHereSelector: ReadonlyPureSelectorToken<
	ViewOf<UList<UserKey> | null>
> = selector({
	key: `usersHere`,
	get: ({ get, find }) => {
		const myRoomKey = get(myRoomKeySelector)
		if (!myRoomKey) return null
		const [usersInRoomsAtoms] = getInternalRelations(usersInRooms, `split`)
		const users = get(find(usersInRoomsAtoms, myRoomKey))
		return users
	},
})

export const roomOwnerSelector: ReadonlyPureSelectorToken<UserKey | null> =
	selector({
		key: `roomOwner`,
		get: ({ get }) => {
			const myRoomKey = get(myRoomKeySelector)
			if (!myRoomKey) return null
			const [, ownerOfRoomsAtoms] = getInternalRelations(ownersOfRooms, `split`)
			const owner = get(ownerOfRoomsAtoms, myRoomKey)
			for (const userKey of owner) return userKey
			return null
		},
	})
