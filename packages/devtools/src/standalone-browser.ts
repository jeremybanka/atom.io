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
				const socket = document.body.hasAttribute(`data-atom-io-devtools-socket`)
					? new WebSocket(
							new URL(`./socket`, document.baseURI),
							DEVTOOLS_SOCKET_PROTOCOL,
						)
					: undefined
				const stream = socket ?? new EventSource(`./events`)
				return {
					send(frame) {
						if (socket && socket.readyState === WebSocket.OPEN)
							socket.send(JSON.stringify(frame))
					},
					listen(receive, disconnected) {
						stream.onmessage = ({ data }: MessageEvent<string>) => {
							try {
								receive(decodeStandaloneFrame(data))
							} catch {
								disconnected()
							}
						}
						stream.onerror = () => {
							disconnected()
						}
						if (socket)
							socket.onclose = () => {
								disconnected()
							}
					},
					close() {
						stream.onmessage = null
						stream.onerror = null
						if (socket) socket.onclose = null
						stream.close()
					},
				}
			},
		},
	],
})

window.addEventListener(`pagehide`, ({ persisted }) => {
	if (!persisted) panel.dispose()
})
