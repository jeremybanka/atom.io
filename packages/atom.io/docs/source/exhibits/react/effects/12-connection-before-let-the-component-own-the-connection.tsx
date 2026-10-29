import { useEffect, useState } from "react"

import { connectToRoom } from "./helpers.ts"

export function ChatRoom({ roomId }: { roomId: string }) {
	const [message, setMessage] = useState(``)
	useEffect(() => {
		setMessage(``)
		return connectToRoom(roomId, setMessage)
	}, [roomId])
	return <output>{message}</output>
}
