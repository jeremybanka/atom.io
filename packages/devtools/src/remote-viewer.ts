import { once } from "node:events"

import { WebSocket } from "ws"

import {
	bindDevtoolsSockets,
	DEVTOOLS_ENDPOINT,
	devtoolsToken,
	MAX_COMMAND_BYTES,
	MAX_STORE_FRAME_BYTES,
	sendWebSocketFrames,
} from "./devtools-websocket.ts"
import { DEVTOOLS_SOCKET_PROTOCOL } from "./standalone-wire.ts"
import { serveViewer, type StandaloneDevtools } from "./viewer-server.ts"

function resolveTarget(address: string): URL {
	const target = new URL(address)
	if (target.protocol === `https:`) target.protocol = `wss:`
	if (target.protocol === `http:`) target.protocol = `ws:`
	if (target.protocol !== `ws:` && target.protocol !== `wss:`)
		throw new Error(`Use an HTTP(S) or WebSocket URL for the Devtools target`)
	if (target.username || target.password || target.search || target.hash)
		throw new Error(
			`Use a Devtools target URL without credentials, a query, or a fragment`,
		)
	if (
		target.protocol === `ws:` &&
		![`localhost`, `127.0.0.1`, `[::1]`].includes(target.hostname)
	)
		throw new Error(`Use HTTPS or WSS for a Devtools target outside loopback`)
	if (target.pathname === `/`) target.pathname = DEVTOOLS_ENDPOINT
	return target
}

function relay(upstream: WebSocket, browser: WebSocket): void {
	const stop = () => {
		upstream.terminate()
		browser.terminate()
	}
	const sendToTarget = sendWebSocketFrames(upstream, MAX_COMMAND_BYTES)
	const sendToBrowser = sendWebSocketFrames(browser, MAX_STORE_FRAME_BYTES)
	let initial = true
	upstream.on(`error`, stop)
	upstream.once(`close`, stop)
	browser.once(`close`, stop)
	upstream.on(`message`, (data, binary) => {
		try {
			if (binary) throw new Error(`Expected a text frame`)
			sendToBrowser((data as Buffer).toString(), initial)
			initial = false
		} catch {
			stop()
		}
	})
	browser.on(`message`, (data, binary) => {
		try {
			if (binary) throw new Error(`Expected a text frame`)
			sendToTarget((data as Buffer).toString())
		} catch {
			stop()
		}
	})
}

export async function serveRemoteViewer(
	address: string,
	token: string | undefined,
	port: number,
): Promise<StandaloneDevtools> {
	const target = resolveTarget(address)
	const authorization = `Bearer ` + devtoolsToken(token)
	const connect = () =>
		new WebSocket(target, DEVTOOLS_SOCKET_PROTOCOL, {
			headers: { authorization },
			handshakeTimeout: 5_000,
			followRedirects: false,
			perMessageDeflate: false,
			maxPayload: MAX_STORE_FRAME_BYTES,
		})

	// Verify the target before printing a local viewer URL. Each tab gets its own stream.
	const probe = connect()
	try {
		await once(probe, `open`)
	} catch (error) {
		throw new Error(
			`Could not connect to the Devtools target: ` + String(error),
			{ cause: error },
		)
	} finally {
		probe.terminate()
	}
	return serveViewer(port, {
		socket(server, url) {
			return bindDevtoolsSockets(
				server,
				url.pathname + `socket`,
				({ headers }) =>
					headers.host === url.host && headers.origin === url.origin,
				(browser) => {
					relay(connect(), browser)
				},
			)
		},
	})
}
