import { act, waitFor } from "@testing-library/react"
import * as AtomIO from "atom.io"
import * as AR from "atom.io/react"
import * as RTR from "atom.io/realtime-react"
import * as RTS from "atom.io/realtime-server"
import * as RTTest from "atom.io/realtime-testing"
import * as React from "react"

const countAtom = AtomIO.atom<number>({ key: `count`, default: 0 })
const countPlusTenSelector = AtomIO.selector<number>({
	key: `countPlusTen`,
	get: ({ get }) => get(countAtom) + 10,
})
const countHundredfoldSelector = AtomIO.selector<number>({
	key: `countHundredfold`,
	get: ({ get }) => get(countAtom) * 100,
	set: ({ set }, value) => {
		set(countAtom, value / 100)
	},
})

describe(`pull atom, observe selector`, () => {
	const scenario = () =>
		RTTest.singleClient({
			server: ({ socket, userKey, silo: { store } }) => {
				const exposeSingle = RTS.realtimeStateProvider({
					socket,
					consumer: userKey,
					store,
				})
				return exposeSingle(countAtom)
			},
			client: () => {
				RTR.usePullSelector(countHundredfoldSelector)
				const plusTen = AR.useO(countPlusTenSelector)
				const hundredfold = AR.useO(countHundredfoldSelector)
				return (
					<>
						<i data-testid={`plusTen:` + plusTen} />
						<i data-testid={`hundredfold:` + hundredfold} />
					</>
				)
			},
		})

	test(`receive atomic update; derive selector update`, async () => {
		const { client: uninitializedClient, server, teardown } = scenario()
		const client = uninitializedClient.init()
		client.renderResult.getByTestId(`plusTen:10`)
		act(() => {
			server.silo.setState(countAtom, 1)
		})
		await waitFor(() => client.renderResult.getByTestId(`plusTen:11`))
		await waitFor(() => client.renderResult.getByTestId(`hundredfold:100`))
		await teardown()
	})
})

describe(`pull selector, observe atom`, () => {
	const scenario = () =>
		RTTest.singleClient({
			server: ({ socket, userKey, silo: { store } }) => {
				const exposeSingle = RTS.realtimeStateProvider({
					socket,
					store,
					consumer: userKey,
				})
				exposeSingle(countAtom)
			},
			client: () => {
				RTR.usePullSelector(countHundredfoldSelector)
				const count = AR.useO(countAtom)
				const countPlusTen = AR.useO(countPlusTenSelector)
				return (
					<>
						<i data-testid={`count:` + count} />
						<i data-testid={`countPlusTen:` + countPlusTen} />
					</>
				)
			},
		})

	test(`receive selector update; derive atomic update`, async () => {
		const { client: uninitializedClient, server, teardown } = scenario()
		const client = uninitializedClient.init()
		client.renderResult.getByTestId(`count:0`)
		act(() => {
			server.silo.setState(countHundredfoldSelector, 2000)
		})
		await waitFor(() => client.renderResult.getByTestId(`count:20`))
		await waitFor(() => client.renderResult.getByTestId(`countPlusTen:30`))
		await teardown()
	})
})

describe(`pull aliased state`, () => {
	const serverCountAtom = AtomIO.atom<number>({
		key: `serverCount`,
		default: 0,
	})
	const clientCountAtom = AtomIO.atom<number>({
		key: `clientCount`,
		default: 0,
	})

	test(`unsubscribes using the client-facing key`, async () => {
		const {
			client: uninitializedClient,
			server,
			teardown,
		} = RTTest.singleClient({
			server: ({ socket, userKey, silo: { store } }) => {
				const exposeSingle = RTS.realtimeStateProvider({
					socket,
					store,
					consumer: userKey,
				})
				return exposeSingle(clientCountAtom, serverCountAtom)
			},
			client: () => {
				const [isSubscribed, setIsSubscribed] = React.useState(true)
				return (
					<>
						<button
							data-testid="unsubscribe"
							onClick={() => setIsSubscribed(false)}
							type="button"
						/>
						{isSubscribed ? <AliasedCount /> : null}
					</>
				)
			},
		})
		const client = uninitializedClient.init()
		const receivedValues: number[] = []
		client.socket.on(`serve:${clientCountAtom.key}`, (value) => {
			receivedValues.push(value)
		})
		await waitFor(() => expect(client.socket.connected).toBe(true))
		act(() => {
			server.silo.setState(serverCountAtom, 1)
		})
		await waitFor(() => expect(receivedValues).toContain(1))

		act(() => client.renderResult.getByTestId(`unsubscribe`).click())
		await new Promise((resolve) => setTimeout(resolve, 100))
		act(() => {
			server.silo.setState(serverCountAtom, 2)
		})
		await new Promise((resolve) => setTimeout(resolve, 100))
		expect(receivedValues).not.toContain(2)
		await teardown()
	})

	function AliasedCount() {
		RTR.usePullAtom(clientCountAtom)
		const count = AR.useO(clientCountAtom)
		return <i data-testid={`clientCount:${count}`} />
	}
})
