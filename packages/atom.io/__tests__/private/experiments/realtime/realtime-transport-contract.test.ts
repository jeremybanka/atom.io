import type { Json } from "atom.io/foundations/json"
import type { Socket } from "atom.io/realtime"
import {
	createDeterministicTransportAdapter,
	createSocketIOTransportAdapter,
} from "atom.io/realtime-testing"

const once = (
	socket: Socket,
	event: string,
): Promise<readonly Json.Serializable[]> =>
	new Promise((resolve) => {
		const listener = (...args: Json.Serializable[]) => {
			socket.off(event, listener)
			resolve(args)
		}
		socket.on(event, listener)
	})

describe.each([
	[`deterministic`, () => createDeterministicTransportAdapter()],
	[`socket.io`, () => createSocketIOTransportAdapter()],
] as const)(`%s transport adapter contract`, (_name, createAdapter) => {
	test(`delivers duplex events and socket observation hooks`, async () => {
		const connection = await createAdapter().connect()
		try {
			const clientOutgoing: string[] = []
			const serverIncoming: string[] = []
			const anyServerListener = (event: string) => serverIncoming.push(event)
			connection.client.onAnyOutgoing((event) => clientOutgoing.push(event))
			connection.server.onAny(anyServerListener)

			const edit = once(connection.server, `edit`)
			connection.client.emit(`edit`, { text: `hello` })
			expect(await edit).toEqual([{ text: `hello` }])
			expect(clientOutgoing).toContain(`edit`)
			expect(serverIncoming).toContain(`edit`)

			connection.server.offAny(anyServerListener)
			const reply = once(connection.client, `reply`)
			connection.server.emit(`reply`, `accepted`)
			expect(await reply).toEqual([`accepted`])
		} finally {
			await connection.dispose()
		}
	})

	test(`removes particular listeners through the common Socket contract`, async () => {
		const connection = await createAdapter().connect()
		try {
			let staleCalls = 0
			const stale = () => {
				staleCalls++
			}
			connection.server.on(`stale`, stale)
			connection.server.off(`stale`, stale)
			const barrier = once(connection.server, `barrier`)
			connection.client.emit(`stale`)
			connection.client.emit(`barrier`)
			await barrier
			expect(staleCalls).toBe(0)
		} finally {
			await connection.dispose()
		}
	})
})
