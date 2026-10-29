import { useO } from "@atom.io/react"
import { atomFamily } from "atom.io"
import type { ReactNode } from "react"
import { useLayoutEffect, useRef, useState } from "react"

import { MessageList } from "./views.tsx"

export const messageAtoms = atomFamily<string[], string>({
	key: `message`,
	default: [],
})
export function Conversation({ roomId }: { roomId: string }): ReactNode {
	const messages = useO(messageAtoms, roomId)
	const [following, setFollowing] = useState(true)
	const list = useRef<HTMLDivElement>(null)
	useLayoutEffect(() => {
		if (following && list.current)
			list.current.scrollTop = list.current.scrollHeight
	}, [messages, following])
	return (
		<MessageList
			listRef={list}
			messages={messages}
			onFollowChange={setFollowing}
		/>
	)
}
