import { mountAtomIODevtools } from "@atom.io/devtools"
import { afterEach, expect, it, vi } from "vitest"

import {
	decodeStandaloneFrame,
	DEVTOOLS_SOCKET_PROTOCOL,
	encodeStandaloneFrame,
	prepareStandaloneValue,
} from "../src/standalone-wire.ts"

vi.mock(`@atom.io/devtools`, () => ({
	mountAtomIODevtools: vi.fn(() => ({ dispose: vi.fn() })),
}))

afterEach(() => {
	vi.unstubAllGlobals()
	document.body.removeAttribute(`data-atom-io-devtools-socket`)
})

it(`preserves supported values and replaces unavailable ones in standalone frames`, () => {
	const roundTrip = (value: unknown) => {
		const frame = decodeStandaloneFrame(
			encodeStandaloneFrame({
				type: `store-update`,
				sequence: 1,
				update: {
					states: [
						{
							token: { key: `sample`, type: `atom` },
							cache: { status: `value`, value: prepareStandaloneValue(value) },
							revision: 0,
							editable: false,
						},
					],
					removedStates: [],
					transactions: [],
					timelines: [],
					removedTimelines: [],
				},
			}),
		)
		expect(frame.type).toBe(`store-update`)
		if (frame.type !== `store-update`) throw new Error(`Expected a store update`)
		return frame.update.states[0].cache
	}
	for (const value of [null, `sample`, new Map([[1, 2]])]) {
		expect(roundTrip(value)).toEqual({ status: `value`, value })
	}
	for (const [value, message] of [
		[
			new Blob([`abc`]),
			`Blob contents are unavailable in the standalone viewer`,
		],
		[new Error(`application error`), `application error`],
		[
			JSON.parse(`{"nested":{"__proto__":{}}}`),
			`Value could not be displayed in the standalone viewer`,
		],
	] as const) {
		const cache = roundTrip(value)
		if (cache.status !== `value`) throw new Error(`Expected a cached value`)
		expect(cache.value).toBeInstanceOf(Error)
		expect(cache.value).toMatchObject({ message })
	}
})

it(`receives standalone events and closes the transport with the page`, async () => {
	const stream = {
		onmessage: null as ((event: MessageEvent<string>) => void) | null,
		onerror: null as (() => void) | null,
		close: vi.fn(),
	}
	const openStream = vi.fn(function () {
		return stream
	})
	vi.stubGlobal(`EventSource`, openStream)
	await import(`../src/standalone-browser.ts`)

	const mount = vi.mocked(mountAtomIODevtools)
	const target = mount.mock.calls[0][1]?.stores?.[0]
	if (target?.kind !== `remote`) throw new Error(`Expected a remote target`)
	const transport = target.connect()
	if (!(`listen` in transport))
		throw new Error(`Expected a standalone transport`)
	expect(openStream).toHaveBeenCalledWith(`./events`)
	const receive = vi.fn()
	const disconnected = vi.fn()
	transport.listen(receive, disconnected)
	stream.onmessage?.(
		new MessageEvent(`message`, {
			data: encodeStandaloneFrame({ type: `close` }),
		}),
	)
	expect(receive).toHaveBeenCalledWith({ type: `close` })
	stream.onmessage?.(new MessageEvent(`message`, { data: `invalid frame` }))
	stream.onerror?.()
	expect(disconnected).toHaveBeenCalledTimes(2)
	transport.send({ type: `close` })
	expect(openStream).toHaveBeenCalledOnce()
	transport.close()
	expect(stream.onmessage).toBeNull()
	expect(stream.onerror).toBeNull()
	expect(stream.close).toHaveBeenCalledOnce()

	const { dispose } = mount.mock.results[0].value
	window.dispatchEvent(Object.assign(new Event(`pagehide`), { persisted: true }))
	expect(dispose).not.toHaveBeenCalled()
	window.dispatchEvent(
		Object.assign(new Event(`pagehide`), { persisted: false }),
	)
	expect(dispose).toHaveBeenCalledOnce()
})

it(`sends control commands only over the connected local socket`, async () => {
	const stream = {
		readyState: 0,
		onclose: null as (() => void) | null,
		send: vi.fn(),
		close: vi.fn(),
	}
	const openSocket = Object.assign(
		vi.fn(function () {
			return stream
		}),
		{ OPEN: 1 },
	)
	vi.stubGlobal(`WebSocket`, openSocket)
	document.body.setAttribute(`data-atom-io-devtools-socket`, ``)
	vi.resetModules()
	await import(`../src/standalone-browser.ts`)

	const target = vi.mocked(mountAtomIODevtools).mock.lastCall?.[1]?.stores?.[0]
	if (target?.kind !== `remote`) throw new Error(`Expected a remote target`)
	const transport = target.connect()
	if (!(`listen` in transport))
		throw new Error(`Expected a standalone transport`)
	expect(openSocket).toHaveBeenCalledWith(
		new URL(`./socket`, document.baseURI),
		DEVTOOLS_SOCKET_PROTOCOL,
	)
	const disconnected = vi.fn()
	transport.listen(vi.fn(), disconnected)
	const frame = { type: `edit`, key: `count`, revision: 0, value: 3 } as const
	transport.send(frame)
	expect(stream.send).not.toHaveBeenCalled()
	stream.readyState = 1
	transport.send(frame)
	expect(stream.send).toHaveBeenCalledWith(JSON.stringify(frame))
	stream.onclose?.()
	expect(disconnected).toHaveBeenCalledOnce()
	transport.close()
	expect(stream.onclose).toBeNull()
	expect(stream.close).toHaveBeenCalledOnce()
})
