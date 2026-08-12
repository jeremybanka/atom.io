import type { Json } from "atom.io/foundations/json"
import type { EventsMap, Socket, StandardSchemaV1 } from "atom.io/realtime"
import { guardSocket } from "atom.io/realtime"

class TestSocket implements Socket {
	public id = `test`
	public listeners = new Map<string, Set<(...args: Json.Array) => void>>()
	public anyListeners = new Set<(event: string, ...args: Json.Array) => void>()
	public on(event: string, listener: (...args: Json.Array) => void): void {
		const listeners = this.listeners.get(event) ?? new Set()
		listeners.add(listener)
		this.listeners.set(event, listeners)
	}
	public onAny(listener: (event: string, ...args: Json.Array) => void): void {
		this.anyListeners.add(listener)
	}
	public onAnyOutgoing(): void {}
	public off(event: string, listener?: (...args: Json.Array) => void): void {
		if (listener) this.listeners.get(event)?.delete(listener)
		else this.listeners.delete(event)
	}
	public offAny(listener?: (event: string, ...args: Json.Array) => void): void {
		if (listener) this.anyListeners.delete(listener)
		else this.anyListeners.clear()
	}
	public emit(event: string, ...args: Json.Array): void {
		for (const listener of this.anyListeners) listener(event, ...args)
		for (const listener of this.listeners.get(event) ?? []) listener(...args)
	}
}

type TestEvents = EventsMap & {
	message: (value: string) => void
}

const schema = (
	validate: (
		args: Json.Array,
	) =>
		| Promise<StandardSchemaV1.Result<[string]>>
		| StandardSchemaV1.Result<[string]>,
): StandardSchemaV1<Json.Array, [string]> => ({
	"~standard": {
		version: 1,
		vendor: `test`,
		validate,
	},
})

describe(`guardSocket`, () => {
	test(`removes exact and all wrapped listeners symmetrically`, async () => {
		const socket = new TestSocket()
		const guarded = guardSocket<TestEvents>(socket, {
			message: schema((args) => ({ value: args as [string] })),
		})
		const listener0 = vi.fn()
		const listener1 = vi.fn()
		const anyListener = vi.fn()

		guarded.on(`message`, listener0)
		guarded.on(`message`, listener1)
		guarded.onAny(anyListener)
		expect(socket.listeners.get(`message`)).toHaveLength(2)
		expect(socket.anyListeners).toHaveLength(1)

		guarded.off(`message`, listener0)
		guarded.offAny(anyListener)
		expect(socket.listeners.get(`message`)).toHaveLength(1)
		expect(socket.anyListeners).toHaveLength(0)

		guarded.off(`message`)
		expect(socket.listeners.get(`message`)).toHaveLength(0)
	})

	test(`fails closed for unknown events and rejected validators`, async () => {
		const socket = new TestSocket()
		const diagnostics: unknown[] = []
		const listener = vi.fn()
		const guarded = guardSocket<TestEvents>(
			socket,
			{
				message: schema(async () => {
					throw new Error(`validator rejected`)
				}),
			},
			(error) => diagnostics.push(error),
		)
		guarded.on(`message`, listener)
		guarded.onAny(listener)

		socket.emit(`unknown`, `payload`)
		socket.emit(`message`, `payload`)
		await vi.waitFor(() => expect(diagnostics).toHaveLength(3))
		expect(listener).not.toHaveBeenCalled()
		expect(diagnostics.map(String).join(` `)).toContain(`unknown`)
		expect(diagnostics.map(String).join(` `)).toContain(`validator rejected`)
	})

	test(`preserves receive order across asynchronous validation`, async () => {
		const socket = new TestSocket()
		const received: string[] = []
		const guarded = guardSocket<TestEvents>(socket, {
			message: schema(async ([value]) => {
				if (value === `first`)
					await new Promise((resolve) => setTimeout(resolve, 10))
				return { value: [value as string] }
			}),
		})
		guarded.on(`message`, (value) => received.push(value))

		socket.emit(`message`, `first`)
		socket.emit(`message`, `second`)
		await vi.waitFor(() => expect(received).toEqual([`first`, `second`]))
	})
})
