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

it(`exchanges frames over the local socket and cleans up when the page closes`, async () => {
	const socket = {
		readyState: 0,
		onmessage: null as ((event: MessageEvent<string>) => void) | null,
		onerror: null as (() => void) | null,
		onclose: null as (() => void) | null,
		send: vi.fn(),
		close: vi.fn(),
	}
	const openSocket = Object.assign(
		vi.fn(function () {
			return socket
		}),
		{ OPEN: 1 },
	)
	vi.stubGlobal(`WebSocket`, openSocket)
	await import(`../src/standalone-browser.ts`)

	const mount = vi.mocked(mountAtomIODevtools)
	const target = mount.mock.lastCall?.[1]?.stores?.[0]
	if (target?.kind !== `remote`) throw new Error(`Expected a remote target`)
	const transport = target.connect()
	if (!(`listen` in transport))
		throw new Error(`Expected a standalone transport`)
	expect(openSocket).toHaveBeenCalledWith(
		new URL(`./socket`, document.baseURI),
		DEVTOOLS_SOCKET_PROTOCOL,
	)
	const disconnected = vi.fn()
	const receive = vi.fn()
	transport.listen(receive, disconnected)
	const frame = { type: `edit`, key: `count`, revision: 0, value: 3 } as const
	transport.send(frame)
	expect(socket.send).not.toHaveBeenCalled()
	socket.readyState = 1
	transport.send(frame)
	expect(socket.send).toHaveBeenCalledWith(JSON.stringify(frame))
	socket.onmessage?.(
		new MessageEvent(`message`, {
			data: encodeStandaloneFrame({ type: `close` }),
		}),
	)
	expect(receive).toHaveBeenCalledWith({ type: `close` })
	socket.onmessage?.(new MessageEvent(`message`, { data: `invalid frame` }))
	socket.onerror?.()
	socket.onclose?.()
	expect(disconnected).toHaveBeenCalledTimes(3)
	transport.close()
	expect(socket.onmessage).toBeNull()
	expect(socket.onerror).toBeNull()
	expect(socket.onclose).toBeNull()
	expect(socket.close).toHaveBeenCalledOnce()

	const { dispose } = mount.mock.results[0].value
	window.dispatchEvent(Object.assign(new Event(`pagehide`), { persisted: true }))
	expect(dispose).not.toHaveBeenCalled()
	window.dispatchEvent(
		Object.assign(new Event(`pagehide`), { persisted: false }),
	)
	expect(dispose).toHaveBeenCalledOnce()
})
