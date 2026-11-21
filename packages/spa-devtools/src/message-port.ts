import type { DevtoolsTransport } from "./transport.ts"

export function messagePortTransport<Incoming, Outgoing>(
	port: MessagePort,
): DevtoolsTransport<Incoming, Outgoing> {
	let detach = () => {}
	return {
		send(message) {
			port.postMessage(message)
		},
		listen(receive, disconnected) {
			const message = ({ data }: MessageEvent<Incoming>) => {
				receive(data)
			}
			detach = () => {
				port.removeEventListener(`message`, message)
				port.removeEventListener(`messageerror`, disconnected)
				port.removeEventListener(`close`, disconnected)
			}
			port.addEventListener(`message`, message)
			port.addEventListener(`messageerror`, disconnected)
			port.addEventListener(`close`, disconnected)
			port.start()
		},
		close() {
			detach()
			port.close()
		},
	}
}
