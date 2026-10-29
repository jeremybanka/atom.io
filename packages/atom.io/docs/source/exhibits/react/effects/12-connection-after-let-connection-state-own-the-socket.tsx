import { useAtomicRef, useO } from "@atom.io/react"
import { atomFamily, setState } from "atom.io"
import type { ReactNode } from "react"
import { useRef } from "react"

import { connectToRoom } from "./helpers.ts"

const receivedMessageAtoms = atomFamily<string, string>({
	key: `receivedMessage`,
	default: ``,
})
const roomNodeAtoms = atomFamily<HTMLOutputElement | null, string>({
	key: `roomNode`,
	default: null,
	effects: (roomId) => [
		({ onSet }) => {
			let disconnect = () => {}
			onSet(({ newValue }) => {
				disconnect()
				disconnect = newValue
					? connectToRoom(roomId, (message) => {
							setState(receivedMessageAtoms, roomId, message)
						})
					: () => {}
			})
			return () => {
				disconnect()
			}
		},
	],
})
export function ChatRoom({ roomId }: { roomId: string }): ReactNode {
	const node = useAtomicRef(roomNodeAtoms, roomId, useRef)
	const message = useO(receivedMessageAtoms, roomId)
	return <output ref={node}>{message}</output>
}
