import { once } from "node:events"
import { createServer, type Server } from "node:http"

import { Silo } from "atom.io"
import { afterEach, expect, it, vi } from "vitest"
import { WebSocket } from "ws"

import {
	attachDevtoolsWebSocket,
	bindDevtoolsSockets,
	DEVTOOLS_ENDPOINT,
	type DevtoolsWebSocketOptions,
	MAX_COMMAND_BYTES,
} from "../src/devtools-websocket.ts"
import * as remoteStore from "../src/remote-store.ts"
import { serveRemoteViewer } from "../src/remote-viewer.ts"
import {
	decodeStandaloneFrame,
	DEVTOOLS_SOCKET_PROTOCOL,
} from "../src/standalone-wire.ts"

const token = `synthetic-test-token`
const cleanup: (() => void | Promise<void>)[] = []

afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close()
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

async function listen(server: Server, detach: () => void) {
	server.listen(0, `127.0.0.1`)
	await once(server, `listening`)
	cleanup.push(
		() =>
			new Promise<void>((close) => {
				detach()
				server.close(() => {
					close()
				})
			}),
	)
	const address = server.address()
	if (!address || typeof address === `string`)
		throw new Error(`Expected a TCP listener`)
	return new URL(`http://127.0.0.1:` + address.port)
}

async function target(
	options: Partial<DevtoolsWebSocketOptions> = {},
	isProduction = false,
) {
	const silo = new Silo({ name: `Target`, lifespan: `ephemeral`, isProduction })
	const countAtom = silo.atom<number>({ key: `count`, default: 1 })
	silo.getState(countAtom)
	const server = createServer()
	const detach = attachDevtoolsWebSocket(server, silo, { token, ...options })
	return { url: await listen(server, detach), silo, countAtom, detach, server }
}

function open(
	url: URL,
	options?: WebSocket.ClientOptions,
	protocol = DEVTOOLS_SOCKET_PROTOCOL,
) {
	const socket = new WebSocket(url, protocol, options)
	socket.on(`error`, () => {})
	cleanup.push(() => {
		socket.terminate()
	})
	return socket
}

async function receive(socket: WebSocket) {
	const [data] = (await once(socket, `message`)) as [Buffer]
	return decodeStandaloneFrame(data.toString())
}

it(`authenticates the target and relays an edit to its production Silo`, async () => {
	const { url, silo, countAtom } = await target(
		{ productionAccess: `control` },
		true,
	)
	await expect(serveRemoteViewer(url.href, `wrong-token`, 0)).rejects.toThrow(
		/403/,
	)
	const viewer = await serveRemoteViewer(url.href, token, 0)
	cleanup.push(viewer.close)
	const page = await fetch(viewer.url)
	expect(await page.text()).toContain(`data-atom-io-devtools-socket`)
	expect((await fetch(new URL(`events`, viewer.url))).status).toBe(404)
	const relay = new URL(`socket`, viewer.url)
	const origin = viewer.url.origin
	for (const options of [
		{ origin: `https://unrelated.test` },
		{ origin, headers: { Host: `unrelated.test` } },
	]) {
		await expect(once(open(relay, options), `open`)).rejects.toThrow(/403/)
	}
	const socket = open(relay, { origin })
	const snapshot = await receive(socket)
	expect(snapshot).toMatchObject({ type: `store`, snapshot: { control: true } })
	socket.send(
		JSON.stringify({ type: `edit`, key: countAtom.key, revision: 0, value: 9 }),
	)
	expect(await receive(socket)).toMatchObject({
		type: `store-update`,
		sequence: 1,
	})
	expect(silo.getState(countAtom)).toBe(9)
	const disconnected = once(socket, `close`)
	await viewer.close()
	await disconnected
	await vi.waitFor(() => {
		expect(silo.store.observation).toBeUndefined()
	})
})

it(`validates remote addresses and requires an explicit production grant`, async () => {
	for (const [url, secret, diagnostic] of [
		[`ftp://example.test`, token, /HTTP\(S\) or WebSocket/],
		[`https://operator@example.test`, token, /without credentials/],
		[`wss://example.test?token=secret`, token, /without credentials/],
		[`wss://example.test/#fragment`, token, /without credentials/],
		[`http://example.test`, token, /outside loopback/],
		[`ws://127.0.0.1`, undefined, /ATOM_IO_DEVTOOLS_TOKEN/],
		[`ws://127.0.0.1`, `with spaces`, /ATOM_IO_DEVTOOLS_TOKEN/],
	] as const) {
		await expect(serveRemoteViewer(url, secret, 0)).rejects.toThrow(diagnostic)
	}
	const server = createServer()
	const production = new Silo({
		name: `Production`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	expect(() => attachDevtoolsWebSocket(server, production, { token })).toThrow(
		/explicit control/,
	)
	const dev = new Silo({
		name: `Development`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	expect(() =>
		attachDevtoolsWebSocket(server, dev, { token, path: `relative` }),
	).toThrow(/absolute/)
	vi.stubEnv(`NODE_ENV`, `production`)
	expect(() => attachDevtoolsWebSocket(server, dev, { token })).toThrow(
		/explicit control/,
	)
})

it(`keeps upgrades private and rejects invalid command frames`, async () => {
	const { url, silo, detach, server } = await target({ path: `/debug` })
	const endpoint = new URL(`/debug`, url)
	const authorization = { headers: { authorization: `Bearer ` + token } }
	await expect(once(open(endpoint), `open`)).rejects.toThrow(/403/)
	await expect(
		once(open(endpoint, authorization, `other`), `open`),
	).rejects.toThrow(/403/)
	await expect(
		once(open(new URL(DEVTOOLS_ENDPOINT, url), authorization), `open`),
	).rejects.toThrow()
	server.on(`upgrade`, (request, socket) => {
		if (request.url === `/other`)
			socket.end(`HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n`)
	})
	await expect(once(open(new URL(`/other`, url)), `open`)).rejects.toThrow(/404/)
	for (const invalid of [
		`{`,
		`{"type":"timeline","key":"count","action":"run"}`,
		Buffer.from(`{}`),
	]) {
		const socket = open(endpoint, authorization)
		expect(await receive(socket)).toMatchObject({ type: `store` })
		const closed = once(socket, `close`)
		socket.send(invalid)
		expect((await closed)[0]).toBe(1008)
	}
	const oversized = open(endpoint, authorization)
	await receive(oversized)
	const rejected = once(oversized, `close`)
	oversized.send(`x`.repeat(MAX_COMMAND_BYTES + 1))
	await rejected

	vi.spyOn(remoteStore, `exposeWholeStore`).mockImplementationOnce(() => {
		throw new Error(`Could not publish the initial store`)
	})
	await once(open(endpoint, authorization), `close`)
	const socket = open(endpoint, authorization)
	await receive(socket)
	const closed = once(socket, `close`)
	detach()
	await closed
	expect(silo.store.observation).toBeUndefined()
})

it(`closes both sides of the relay on a non-text frame`, async () => {
	const connections: WebSocket[] = []
	const server = createServer()
	const detach = bindDevtoolsSockets(
		server,
		`/debug`,
		() => true,
		(socket) => {
			connections.push(socket)
		},
	)
	const address = await listen(server, detach)
	const viewer = await serveRemoteViewer(
		new URL(`/debug`, address).href,
		token,
		0,
	)
	cleanup.push(viewer.close)
	const relay = new URL(`socket`, viewer.url)
	for (const direction of [`target`, `browser`]) {
		const previous = connections.length
		const socket = open(relay, { origin: viewer.url.origin })
		await once(socket, `open`)
		await vi.waitFor(() => {
			expect(connections).toHaveLength(previous + 1)
		})
		const upstream = connections.at(-1)!
		const disconnected = [once(socket, `close`), once(upstream, `close`)]
		const sender = direction === `target` ? upstream : socket
		sender.send(Buffer.from(`{}`))
		await Promise.all(disconnected)
	}
})
