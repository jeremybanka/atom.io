import type { ReactNode } from "react"
import { useEffect, useState } from "react"

import { sendMessage } from "./services.ts"

export function SendButton({ text }: { text: string }): ReactNode {
	const [requested, setRequested] = useState(false)
	const [status, setStatus] = useState(`Ready`)
	useEffect(() => {
		if (!requested) return
		setStatus(`Sending`)
		void sendMessage(text)
			.then(
				() => {
					setStatus(`Sent`)
				},
				() => {
					setStatus(`Failed`)
				},
			)
			.finally(() => {
				setRequested(false)
			})
	}, [requested, text])
	return (
		<button
			type="button"
			disabled={requested}
			onClick={() => {
				setRequested(true)
			}}
		>
			{status}
		</button>
	)
}
