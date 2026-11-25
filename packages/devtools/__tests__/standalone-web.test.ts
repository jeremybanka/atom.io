import { mountAtomIODevtools } from "@atom.io/devtools"
import { afterEach, expect, it, vi } from "vitest"

import {
	decodeStandaloneFrame,
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
