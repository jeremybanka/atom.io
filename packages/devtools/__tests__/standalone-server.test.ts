import { EventEmitter } from "node:events"
import { readFile } from "node:fs/promises"
import {
	createServer,
	type IncomingMessage,
	type RequestListener,
	type Server,
	type ServerResponse,
} from "node:http"

import { afterEach, expect, it, vi } from "vitest"

import { serveViewer } from "../src/viewer-server.ts"

vi.mock(`node:http`, () => ({ createServer: vi.fn() }))
vi.mock(`node:fs/promises`, () => ({ readFile: vi.fn() }))

afterEach(() => {
	vi.clearAllMocks()
})

function serverFixture() {
	const server = Object.assign(new EventEmitter(), {
		listen: vi.fn((_port: number, _host: string, ready: () => void) => {
			ready()
		}),
		address: vi.fn<Server[`address`]>(() => ({
			address: `127.0.0.1`,
			family: `IPv4`,
			port: 80,
		})),
		close: vi.fn((closed?: (error?: Error) => void) => closed?.()),
		closeAllConnections: vi.fn(),
	})
	vi.mocked(createServer).mockReturnValue(server as unknown as Server)
	const closeSocket = vi.fn()
	const bindSocket = vi.fn(() => closeSocket)
	const start = (port = 0) => serveViewer(port, bindSocket)

	function request(url?: string, host = `127.0.0.1`, method = `GET`) {
		const response = {
			setHeader: vi.fn(),
			writeHead: vi.fn().mockReturnThis(),
			end: vi.fn(),
		}
		const receive = vi.mocked(createServer).mock.lastCall?.[0] as RequestListener
		receive(
			{ url, method, headers: { host } } as IncomingMessage,
			response as unknown as ServerResponse,
		)
		return response
	}
	return { server, request, start, bindSocket, closeSocket }
}

it(`serves only the private path and approved assets on the bound authority`, async () => {
	const { server, request, start, bindSocket, closeSocket } = serverFixture()
	const viewer = await start(80)
	expect(server.listen).toHaveBeenCalledWith(
		80,
		`127.0.0.1`,
		expect.any(Function),
	)
	expect(viewer.url.host).toBe(`127.0.0.1`)
	expect(bindSocket).toHaveBeenCalledWith(server, viewer.url)
	const path = viewer.url.pathname
	for (const host of [viewer.url.host, `127.0.0.1:80`]) {
		const page = request(path, host)
		expect(page.writeHead).toHaveBeenCalledWith(200, {
			"Content-Type": `text/html; charset=utf-8`,
		})
		expect(page.end).toHaveBeenCalledWith(
			expect.stringContaining(`./standalone-browser.js`),
		)
		expect(page.setHeader).toHaveBeenCalledWith(`Referrer-Policy`, `no-referrer`)
	}
	for (const invalid of [
		request(path, `elsewhere.example`),
		request(path, viewer.url.host, `POST`),
		request(undefined),
		request(`/socket`),
		request(path + `socket`),
		request(path + `something.txt`),
	]) {
		expect(invalid.writeHead).toHaveBeenCalledWith(404)
	}
	const files = [
		[`devtools.css`, `text/css; charset=utf-8`],
		[`standalone-browser.js`, `text/javascript; charset=utf-8`],
		[`fonts/regular.otf`, `font/otf`],
		[`brand-fallback/mark.webp`, `image/webp`],
	]
	const body = Buffer.from(`asset`)
	vi.mocked(readFile).mockResolvedValue(body)
	for (const [name, type] of files) {
		const response = request(path + name)
		await Promise.resolve()
		expect(readFile).toHaveBeenLastCalledWith(
			expect.objectContaining({
				pathname: expect.stringContaining(name),
			}),
		)
		expect(response.writeHead).toHaveBeenCalledWith(200, {
			"Content-Type": type,
		})
		expect(response.end).toHaveBeenCalledWith(body)
	}
	vi.mocked(readFile).mockRejectedValueOnce(new Error(`Asset missing`))
	const missing = request(path + `fonts/missing.otf`)
	await Promise.resolve()
	expect(missing.writeHead).toHaveBeenCalledWith(404)
	const closed = viewer.close()
	expect(viewer.close()).toBe(closed)
	await closed
	expect(closeSocket).toHaveBeenCalledOnce()
	expect(server.closeAllConnections).toHaveBeenCalledOnce()
})

it(`surfaces listener and shutdown failures`, async () => {
	const { server, start } = serverFixture()
	server.listen.mockImplementationOnce(() => {
		server.emit(`error`, new Error(`Address in use`))
	})
	await expect(start()).rejects.toThrow(`Address in use`)
	for (const address of [null, `unix-socket`]) {
		server.address.mockReturnValueOnce(address)
		await expect(start()).rejects.toThrow(`no TCP address`)
	}
	const viewer = await start()
	server.close.mockImplementationOnce((closed) =>
		closed?.(new Error(`Cannot close`)),
	)
	await expect(viewer.close()).rejects.toThrow(`Cannot close`)
})
