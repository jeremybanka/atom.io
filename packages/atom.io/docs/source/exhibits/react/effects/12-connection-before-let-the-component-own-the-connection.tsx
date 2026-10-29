import type { ReactNode } from "react"
import { useEffect, useState } from "react"

import { connectToRoom } from "./helpers.ts"

export function ChatRoom({ roomId }: { roomId: string }): ReactNode {
	const [message, setMessage] = useState(``)
	useEffect(() => {
		setMessage(``)
		return connectToRoom(roomId, setMessage)
	}, [roomId])
	return <output>{message}</output>
}
