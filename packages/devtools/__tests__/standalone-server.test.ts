import { EventEmitter } from "node:events"
import { readFile } from "node:fs/promises"
import {
	createServer,
	type IncomingMessage,
	type RequestListener,
	type Server,
	type ServerResponse,
} from "node:http"

import { Silo } from "atom.io"
import { afterEach, expect, it, vi } from "vitest"

import { serveDevtoolsStore } from "../src/standalone.ts"
import { decodeStandaloneFrame } from "../src/standalone-wire.ts"

vi.mock(`node:http`, () => ({ createServer: vi.fn() }))
vi.mock(`node:fs/promises`, () => ({ readFile: vi.fn() }))

afterEach(() => {
	vi.clearAllMocks()
	vi.unstubAllEnvs()
})

function serverFixture() {
	const silo = new Silo({
		name: `Viewer test`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
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

	function request(url?: string, host = `127.0.0.1`, method = `GET`) {
		const response = Object.assign(new EventEmitter(), {
			setHeader: vi.fn(),
			writeHead: vi.fn().mockReturnThis(),
			write: vi.fn((_data: string, flushed?: () => void) => {
				flushed?.()
			}),
			end: vi.fn(),
			destroy: vi.fn(),
		})
		const receive = vi.mocked(createServer).mock.lastCall?.[0] as RequestListener
		const send = () => {
			receive(
				{ url, method, headers: { host } } as IncomingMessage,
				response as unknown as ServerResponse,
			)
			return response
		}
		return { response, send }
	}
	return { silo, server, request }
}

it(`serves only the private path and approved assets on the bound authority`, async () => {
	const { silo, server, request } = serverFixture()
	const viewer = await serveDevtoolsStore(silo, { port: 80 })
	expect(server.listen).toHaveBeenCalledWith(
		80,
		`127.0.0.1`,
		expect.any(Function),
	)
	expect(viewer.url.host).toBe(`127.0.0.1`)
	const path = viewer.url.pathname
	for (const host of [viewer.url.host, `127.0.0.1:80`]) {
		const page = request(path, host).send()
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
		request(`/events`),
		request(path + `something.txt`),
	]) {
		expect(invalid.send().writeHead).toHaveBeenCalledWith(404)
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
		const response = request(path + name).send()
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
	const missing = request(path + `fonts/missing.otf`).send()
	await Promise.resolve()
	expect(missing.writeHead).toHaveBeenCalledWith(404)
	const closed = viewer.close()
	expect(viewer.close()).toBe(closed)
	await closed
	expect(server.closeAllConnections).toHaveBeenCalledOnce()
})

it(`requires production opt-in at startup and when opening a stream`, async () => {
	const { silo, request } = serverFixture()
	const viewer = await serveDevtoolsStore(silo)
	silo.store.config.isProduction = true
	const events = viewer.url.pathname + `events`
	expect(request(events).send().writeHead).toHaveBeenCalledWith(404)
	await expect(serveDevtoolsStore(silo)).rejects.toThrow(/explicit inspection/)
	silo.store.config.isProduction = false
	vi.stubEnv(`NODE_ENV`, `production`)
	await expect(serveDevtoolsStore(silo)).rejects.toThrow(/explicit inspection/)
	const allowed = await serveDevtoolsStore(silo, { productionAccess: `inspect` })
	const response = request(allowed.url.pathname + `events`).send()
	expect(response.writeHead).toHaveBeenCalledWith(200, {
		"Content-Type": `text/event-stream; charset=utf-8`,
	})
	response.emit(`close`)
	expect(silo.store.observation).toBeUndefined()
	await viewer.close()
	await allowed.close()
})

it(`streams ordered updates and drops a client with a stalled update queue`, async () => {
	const { silo, request } = serverFixture()
	const countAtom = silo.atom<number>({ key: `count`, default: 1 })
	const payloadAtom = silo.atom<string>({ key: `payload`, default: `` })
	silo.getState(countAtom)
	const viewer = await serveDevtoolsStore(silo)
	const events = viewer.url.pathname + `events`
	const response = request(events).send()
	const frame = () =>
		decodeStandaloneFrame(response.write.mock.lastCall![0].slice(6).trimEnd())
	expect(frame()).toMatchObject({
		type: `store`,
		snapshot: {
			control: false,
			states: expect.arrayContaining([
				expect.objectContaining({
					token: countAtom,
					cache: { status: `value`, value: 1 },
				}),
			]),
		},
	})
	silo.setState(countAtom, 2)
	await vi.waitFor(() => {
		expect(frame()).toMatchObject({ type: `store-update`, sequence: 1 })
	})

	response.write.mockImplementation(() => {})
	silo.setState(payloadAtom, `x`.repeat(9 * 1024 * 1024))
	await vi.waitFor(() => {
		expect(response.write).toHaveBeenCalledTimes(3)
	})
	silo.setState(countAtom, 3)
	await vi.waitFor(() => {
		expect(response.destroy).toHaveBeenCalled()
	})
	expect(silo.store.observation).toBeUndefined()

	const failed = request(events)
	failed.response.write.mockImplementationOnce(() => {
		throw new Error(`Socket closed while writing`)
	})
	expect(failed.send().destroy).toHaveBeenCalledOnce()
	expect(silo.store.observation).toBeUndefined()
	await viewer.close()
})

it(`surfaces listener and shutdown failures`, async () => {
	const { silo, server } = serverFixture()
	server.listen.mockImplementationOnce(() => {
		server.emit(`error`, new Error(`Address in use`))
	})
	await expect(serveDevtoolsStore(silo)).rejects.toThrow(`Address in use`)
	for (const address of [null, `unix-socket`]) {
		server.address.mockReturnValueOnce(address)
		await expect(serveDevtoolsStore(silo)).rejects.toThrow(`no TCP address`)
	}
	const viewer = await serveDevtoolsStore(silo)
	server.close.mockImplementationOnce((closed) =>
		closed?.(new Error(`Cannot close`)),
	)
	await expect(viewer.close()).rejects.toThrow(`Cannot close`)
})
