import { mountAtomIODevtools } from "@atom.io/devtools"

import { decodeStandaloneFrame } from "./standalone-wire.ts"

const panel = mountAtomIODevtools(document.body, {
	stores: [
		{
			id: `standalone`,
			label: `Remote store`,
			kind: `remote`,
			connect() {
				const stream = new EventSource(`./events`)
				return {
					send() {
						// The standalone transport exposes cached data in one direction.
					},
					listen(receive, disconnected) {
						stream.onmessage = ({ data }: MessageEvent<string>) => {
							try {
								receive(decodeStandaloneFrame(data))
							} catch {
								disconnected()
							}
						}
						stream.onerror = () => disconnected()
					},
					close() {
						stream.onmessage = null
						stream.onerror = null
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
