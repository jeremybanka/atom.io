import { useEffect, useRef, useState } from "react"

import { MessageList } from "./views.tsx"

export function Conversation({ messages }: { messages: string[] }) {
	const list = useRef<HTMLDivElement>(null)
	const [following, setFollowing] = useState(true)
	useEffect(() => {
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
