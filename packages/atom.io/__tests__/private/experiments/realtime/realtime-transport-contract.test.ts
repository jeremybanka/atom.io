import * as http from "node:http"

import type { Json } from "atom.io/foundations/json"
import type { Socket } from "atom.io/realtime"
import {
	createDeterministicTransportAdapter,
	createSocketIOTransportAdapter,
	SOCKET_IO_TEST_ENDPOINT_AUTH,
} from "atom.io/realtime-testing"
import type { Socket as SocketIOServerSocket } from "socket.io"

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

const requestText = (url: string): Promise<string> =>
	new Promise((resolve, reject) => {
		http
			.get(url, (response) => {
				response.setEncoding(`utf8`)
				let body = ``
				response.on(`data`, (chunk: string) => {
					body += chunk
				})
				response.on(`end`, () => {
					resolve(body)
				})
			})
			.on(`error`, reject)
	})

describe.each([
	[`deterministic`, () => createDeterministicTransportAdapter()],
	[`socket.io`, () => createSocketIOTransportAdapter()],
] as const)(`%s transport adapter contract`, (_name, createAdapter) => {
	test(`delivers duplex events and socket observation hooks`, async () => {
		const connection = await createAdapter().connect({
			client: { id: `alice`, session: `alice-tab` },
			server: { id: `origin`, session: `origin-node-1` },
		})
		try {
			expect(connection.endpoints).toEqual({
				client: { id: `alice`, session: `alice-tab` },
				server: { id: `origin`, session: `origin-node-1` },
			})
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

	test(`rejects invalid logical endpoint metadata`, async () => {
		await expect(
			Promise.resolve().then(() =>
				createAdapter().connect({ client: { id: ``, session: `tab` } }),
			),
		).rejects.toThrow(`Transport endpoint id cannot be empty`)
		await expect(
			Promise.resolve().then(() =>
				createAdapter().connect({ client: { id: `alice`, session: `` } }),
			),
		).rejects.toThrow(`Transport endpoint session cannot be empty`)
	})
})

test(`Socket.IO carries logical client and session metadata in its handshake`, async () => {
	const connection = await createSocketIOTransportAdapter().connect({
		client: { id: `alice`, session: `alice-tab` },
		server: { id: `origin`, session: `origin-node-1` },
	})
	try {
		const server = connection.server as SocketIOServerSocket
		expect(server.handshake.auth[SOCKET_IO_TEST_ENDPOINT_AUTH]).toEqual({
			client: { id: `alice`, session: `alice-tab` },
			server: { id: `origin`, session: `origin-node-1` },
		})
	} finally {
		await connection.dispose()
	}
	await connection.dispose()
	expect((connection.client as { connected?: boolean }).connected).toBe(false)
	expect((connection.server as SocketIOServerSocket).connected).toBe(false)
})

test(`Socket.IO closes its listener when connection setup fails`, async () => {
	const adapter = createSocketIOTransportAdapter({
		clientOptions: { auth: () => ({ token: `dynamic` }) },
	})
	await expect(adapter.connect()).rejects.toThrow(`requires object auth`)
	const recovery = await createSocketIOTransportAdapter().connect()
	await recovery.dispose()
})

test(`Socket.IO validates harness metadata and serves its health response`, async () => {
	const adapter = createSocketIOTransportAdapter()
	const harness = adapter.openHarness({ id: `origin`, session: `node-1` })
	try {
		expect(await requestText(`http://127.0.0.1:${harness.port}`)).toBe(
			`Hello World!`,
		)
		const auth = {
			[SOCKET_IO_TEST_ENDPOINT_AUTH]: {
				client: { id: `alice`, session: `tab-1` },
				server: { id: `origin`, session: `node-1` },
			},
		}
		expect(
			adapter.validateHarnessEndpoint(
				auth,
				{ id: `alice`, session: `tab-1` },
				{ id: `origin`, session: `node-1` },
			),
		).toEqual(auth[SOCKET_IO_TEST_ENDPOINT_AUTH])
		expect(() =>
			adapter.validateHarnessEndpoint(
				{},
				{ id: `alice`, session: `tab-1` },
				{ id: `origin`, session: `node-1` },
			),
		).toThrow(`Socket.IO endpoint metadata mismatch`)
		expect(() =>
			adapter.validateHarnessEndpoint(
				{ [SOCKET_IO_TEST_ENDPOINT_AUTH]: null },
				{ id: `alice`, session: `tab-1` },
				{ id: `origin`, session: `node-1` },
			),
		).toThrow(`Socket.IO endpoint metadata mismatch`)
		expect(() =>
			adapter.validateHarnessEndpoint(
				{
					[SOCKET_IO_TEST_ENDPOINT_AUTH]: {
						...auth[SOCKET_IO_TEST_ENDPOINT_AUTH],
						client: { id: `mallory`, session: `tab-1` },
					},
				},
				{ id: `alice`, session: `tab-1` },
				{ id: `origin`, session: `node-1` },
			),
		).toThrow(`Socket.IO endpoint metadata mismatch`)
	} finally {
		await harness.server.close()
	}
})

test(`Socket.IO rejects callback auth before opening a connection`, async () => {
	const adapter = createSocketIOTransportAdapter({
		clientOptions: { auth: () => {} },
	})
	await expect(adapter.connect()).rejects.toThrow(
		`SocketIOTransportAdapter requires object auth`,
	)
})
