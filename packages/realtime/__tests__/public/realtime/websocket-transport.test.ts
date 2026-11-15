import type { RealtimeWebSocket } from "@atom.io/realtime"
import { createWebSocketTransport } from "@atom.io/realtime"
import { acceptCloudflareRealtimeConnection } from "@atom.io/realtime/server/cloudflare"
import { describe, expect, test } from "vitest"

class Wire extends EventTarget implements RealtimeWebSocket {
	public readyState = 0
	public bufferedAmount = 0
	public sent: string[] = []
	public closed: number | undefined
	public accept(): void {
		this.readyState = 1
	}
	public send(data: string): void {
		this.sent.push(data)
	}
	public close(code?: number): void {
		this.closed = code
		this.readyState = 3
		this.dispatchEvent(new Event(`close`))
	}
	public open(): void {
		this.readyState = 1
		this.dispatchEvent(new Event(`open`))
	}
	public receive(data: string): void {
		this.dispatchEvent(new MessageEvent(`message`, { data }))
	}
}

describe(`native WebSocket transport`, () => {
	test(`fails closed when buffered sending fails and rejects non-JSON outgoing values`, () => {
		const wire = new Wire()
		const errors: Error[] = []
		const socket = createWebSocketTransport(wire, {
			sessionId: `session`,
			onError: (error) => {
				errors.push(error)
			},
		})
		expect(() => {
			socket.emit(`value`, Number.NaN)
		}).toThrow(/Invalid/)
		socket.emit(`subscribe`)
		wire.send = () => {
			throw new Error(`send failed`)
		}
		wire.open()
		expect(socket.id).toBeUndefined()
		expect(wire.closed).toBe(1011)
		expect(errors).toHaveLength(1)
	})

	test(`closes accepted Workers sockets if transport setup fails`, async () => {
		const wire = new Wire()
		await expect(
			acceptCloudflareRealtimeConnection({
				webSocket: wire,
				request: new Request(`https://example.com`),
				sessionId: ``,
				authenticate: () => Promise.resolve(`actor`),
				setup: () => () => {},
			}),
		).rejects.toThrow(/session ID/)
		expect(wire.closed).toBe(1011)
	})

	test(`buffers initial subscriptions, preserves listener identity, and restores on replacement`, () => {
		const wire = new Wire()
		const socket = createWebSocketTransport(wire, { sessionId: `first` })
		const received: unknown[] = []
		const listener = (value: unknown): void => {
			received.push(value)
		}
		socket.on(`serve:a`, listener)
		socket.emit(`sub:a`)
		expect(wire.sent).toEqual([])
		wire.open()
		expect(JSON.parse(wire.sent[0])).toEqual({ v: 1, event: `sub:a`, args: [] })
		wire.receive(JSON.stringify({ v: 1, event: `serve:a`, args: [4] }))
		expect(received).toEqual([4])
		socket.off(`serve:a`, listener)
		wire.receive(JSON.stringify({ v: 1, event: `serve:a`, args: [5] }))
		expect(received).toEqual([4])
		const sessions: (string | undefined)[] = []
		socket.on(`connect`, () => {
			sessions.push(socket.id)
			socket.emit(`sub:a`)
		})
		const replacement = new Wire()
		socket.replace(replacement, `second`)
		expect(socket.id).toBeUndefined()
		replacement.open()
		expect(sessions).toEqual([`second`])
		expect(replacement.sent).toHaveLength(1)
		socket.dispose()
		expect(socket.id).toBeUndefined()
		expect(replacement.closed).toBe(1000)
		// A coalesced disposer may run after the connection has been torn down.
		socket.emit(`unsub:a`)
		expect(replacement.sent).toHaveLength(1)
	})

	test(`rejects forged lifecycle, oversized and incompatible frames without dispatching`, () => {
		for (const frame of [
			JSON.stringify({ v: 1, event: `connect`, args: [] }),
			JSON.stringify({ v: 2, event: `event`, args: [] }),
			`x`.repeat(129),
			`{"v":1,"event":"value","args":[1e999]}`,
		]) {
			const wire = new Wire()
			wire.accept()
			const socket = createWebSocketTransport(wire, {
				sessionId: `session`,
				maxMessageBytes: 128,
			})
			let calls = 0
			socket.onAny(() => {
				calls++
			})
			wire.receive(frame)
			expect(calls).toBe(0)
			expect(wire.closed).toBe(1008)
			expect(socket.id).toBeUndefined()
		}
	})

	test(`bounds initial buffering and native backpressure`, () => {
		const wire = new Wire()
		const socket = createWebSocketTransport(wire, {
			sessionId: `session`,
			maxBufferedBytes: 64,
		})
		socket.emit(`x`, `1234567890`)
		expect(() => {
			socket.emit(`x`, `1234567890`)
		}).toThrow(/backpressure/)
		wire.open()
		wire.bufferedAmount = 64
		expect(() => {
			socket.emit(`x`)
		}).toThrow(/backpressure/)
	})

	test(`authenticates before accepting and cleans up even when disconnect races setup`, async () => {
		const rejected = new Wire()
		await expect(
			acceptCloudflareRealtimeConnection({
				webSocket: rejected,
				request: new Request(`https://example.com`),
				sessionId: `session`,
				authenticate: () => Promise.reject(new Error(`Denied`)),
				setup: () => () => {},
			}),
		).rejects.toThrow(`Denied`)
		expect(rejected.readyState).toBe(0)
		const wire = new Wire()
		let finish!: (cleanup: () => void) => void
		let cleanups = 0
		const promise = acceptCloudflareRealtimeConnection({
			webSocket: wire,
			request: new Request(`https://example.com`),
			sessionId: `session`,
			authenticate: () => Promise.resolve(`actor`),
			setup: () =>
				new Promise<() => void>((resolve) => {
					finish = resolve
				}),
		})
		await Promise.resolve()
		await Promise.resolve()
		wire.close()
		finish(() => {
			cleanups++
		})
		const connection = await promise
		await connection.dispose()
		await connection.dispose()
		expect(cleanups).toBe(1)
	})
})
