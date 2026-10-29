import { useI, useO } from "@atom.io/react"
import { atom } from "atom.io"

import { sendMessage } from "./services.ts"

const sendStatusAtom = atom<string>({
	key: `sendStatus`,
	default: `Ready`,
})
export function SendButton({ text }: { text: string }) {
	const status = useO(sendStatusAtom)
	const setStatus = useI(sendStatusAtom)
	function send() {
		setStatus(`Sending`)
		void sendMessage(text).then(
			() => setStatus(`Sent`),
			() => setStatus(`Failed`),
		)
	}
	return (
		<button type="button" disabled={status === `Sending`} onClick={send}>
			{status}
		</button>
	)
}
