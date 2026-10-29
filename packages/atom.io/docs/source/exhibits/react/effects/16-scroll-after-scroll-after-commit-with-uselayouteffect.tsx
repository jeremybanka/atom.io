import { useI, useO } from "@atom.io/react"
import { atomFamily } from "atom.io"
import { useLayoutEffect, useRef } from "react"

import { MessageList } from "./views.tsx"

export const messageAtoms = atomFamily<string[], string>({
	key: `message`,
	default: [],
})
const followingAtoms = atomFamily<boolean, string>({
	key: `following`,
	default: true,
})
export function Conversation({ roomId }: { roomId: string }) {
	const messages = useO(messageAtoms, roomId)
	const following = useO(followingAtoms, roomId)
	const setFollowing = useI(followingAtoms, roomId)
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
