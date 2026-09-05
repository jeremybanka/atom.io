import * as RTTest from "atom.io/realtime-testing/headless"
import * as RTTestReact from "atom.io/realtime-testing/react"
import type { Socket } from "socket.io-client"

const awaitConnection = async (socket: Socket): Promise<void> => {
	if (socket.connected) return
	await new Promise<void>((resolve) => {
		socket.once(`connect`, resolve)
	})
}

describe(`React compatibility harness transport boundary`, () => {
	test(`headless clients open their host and connection through the adapter`, async () => {
		const adapter = RTTest.createSocketIOTransportAdapter()
		const openHarness = vi.spyOn(adapter, `openHarness`)
		const connectHarnessClient = vi.spyOn(adapter, `connectHarnessClient`)
		const scenario = RTTest.headless({
			server: () => {},
			transportAdapter: adapter,
		})
		expect(openHarness).toHaveBeenCalledOnce()
		const client = scenario.createClient({ name: `headless` })
		expect(connectHarnessClient).toHaveBeenCalledOnce()
		await awaitConnection(client.socket)
		await scenario.teardown()
	})

	test(`singleClient opens its host and client through the adapter`, async () => {
		const adapter = RTTest.createSocketIOTransportAdapter()
		const openHarness = vi.spyOn(adapter, `openHarness`)
		const connectHarnessClient = vi.spyOn(adapter, `connectHarnessClient`)
		const scenario = RTTestReact.singleClient({
			client: () => null,
			server: () => {},
			transportAdapter: adapter,
		})
		expect(openHarness).toHaveBeenCalledOnce()
		const client = scenario.client.init()
		expect(connectHarnessClient).toHaveBeenCalledOnce()
		await awaitConnection(client.socket)
		await scenario.teardown()
	})

	test(`multiClient connects every client through the adapter host`, async () => {
		const adapter = RTTest.createSocketIOTransportAdapter()
		const openHarness = vi.spyOn(adapter, `openHarness`)
		const connectHarnessClient = vi.spyOn(adapter, `connectHarnessClient`)
		const scenario = RTTestReact.multiClient({
			clients: { alice: () => null, bob: () => null },
			server: () => {},
			transportAdapter: adapter,
		})
		expect(openHarness).toHaveBeenCalledOnce()
		const alice = scenario.clients.alice.init()
		const bob = scenario.clients.bob.init()
		expect(connectHarnessClient).toHaveBeenCalledTimes(2)
		await Promise.all([
			awaitConnection(alice.socket),
			awaitConnection(bob.socket),
		])
		await scenario.teardown()
	})
})
