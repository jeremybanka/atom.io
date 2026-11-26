import { mountAtomIODevtools } from "@atom.io/devtools"

import {
	decodeStandaloneFrame,
	DEVTOOLS_SOCKET_PROTOCOL,
} from "./standalone-wire.ts"

const panel = mountAtomIODevtools(document.body, {
	stores: [
		{
			id: `standalone`,
			label: `Remote store`,
			kind: `remote`,
			connect() {
				const socket = new WebSocket(
					new URL(`./socket`, document.baseURI),
					DEVTOOLS_SOCKET_PROTOCOL,
				)
				return {
					send(frame) {
						if (socket.readyState === WebSocket.OPEN)
							socket.send(JSON.stringify(frame))
					},
					listen(receive, disconnected) {
						socket.onmessage = ({ data }: MessageEvent<string>) => {
							try {
								receive(decodeStandaloneFrame(data))
							} catch {
								disconnected()
							}
						}
						socket.onerror = socket.onclose = () => {
							disconnected()
						}
					},
					close() {
						socket.onmessage = null
						socket.onerror = null
						socket.onclose = null
						socket.close()
					},
				}
			},
		},
	],
})

window.addEventListener(`pagehide`, ({ persisted }) => {
	if (!persisted) panel.dispose()
})
