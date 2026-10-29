import type { ReactNode } from "react"
import { useState } from "react"

import { sendMessage } from "./services.ts"

export function SendButton({ text }: { text: string }): ReactNode {
	const [status, setStatus] = useState(`Ready`)
	function send() {
		setStatus(`Sending`)
		void sendMessage(text).then(
			() => {
				setStatus(`Sent`)
			},
			() => {
				setStatus(`Failed`)
			},
		)
	}
	return (
		<button type="button" disabled={status === `Sending`} onClick={send}>
			{status}
		</button>
	)
}
