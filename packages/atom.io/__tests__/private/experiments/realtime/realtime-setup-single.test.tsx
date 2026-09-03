import { act, waitFor } from "@testing-library/react"
import * as AtomIO from "atom.io"
import * as AR from "atom.io/react"
import * as RTR from "atom.io/realtime-react"
import * as RTS from "atom.io/realtime-server"
import * as RTTest from "atom.io/realtime-testing/react"

const countAtom = AtomIO.atom<number>({ key: `count`, default: 0 })

describe(`single-client scenario`, () => {
	const scenario = () => {
		const { server, client, teardown } = RTTest.singleClient({
			server: ({ socket, userKey, silo: { store } }) => {
				const exposeSingle = RTS.realtimeStateProvider({
					socket,
					store,
					consumer: userKey,
				})
				return exposeSingle(countAtom)
			},
			client: () => {
				RTR.usePullAtom(countAtom)
				const count = AR.useO(countAtom)
				return <i data-testid={count} />
			},
		})

		return { client, server, teardown }
	}

	it(`responds to changes on the server`, async () => {
		const { client, server, teardown } = scenario()
		const app = client.init()
		app.renderResult.getByTestId(`0`)
		act(() => {
			server.silo.setState(countAtom, 1)
		})
		await waitFor(() => app.renderResult.getByTestId(`1`))
		await teardown()
	})

	it(`resubscribes after reconnecting without remounting`, async () => {
		const { client, server, teardown } = scenario()
		const app = client.init()
		await waitFor(() => {
			expect(app.socket.connected).toBe(true)
		})

		app.socket.disconnect()
		await waitFor(() => {
			expect(app.socket.connected).toBe(false)
		})
		act(() => {
			server.silo.setState(countAtom, 1)
		})
		app.socket.connect()

		await waitFor(() => {
			expect(app.socket.connected).toBe(true)
		})
		await waitFor(() => app.renderResult.getByTestId(`1`))
		act(() => {
			server.silo.setState(countAtom, 2)
		})
		await waitFor(() => app.renderResult.getByTestId(`2`))
		await teardown()
	})
})
