import { createMosaicDomainSessionClient } from "atom.io/realtime-client"
import { vi } from "vitest"

function sessionFixture(
	options: { connected?: boolean; revision?: number } = {},
) {
	const socketListeners = new Map<string, Set<() => void>>()
	const residencyListeners = new Set<(state: any) => void>()
	const historyListeners = new Set<() => void>()
	const presenceListeners = new Set<() => void>()
	const residencyState = {
		connectivity: `live`,
		headRevision: options.revision ?? 0,
		problem: null,
	}
	const historyState: any = {
		pending: 0,
		problem: null,
		snapshot: null,
		status: `live`,
	}
	const socket = {
		connected: options.connected ?? true,
		dispatch(event: `connect` | `disconnect`) {
			for (const listener of socketListeners.get(event) ?? []) listener()
		},
		off(event: string, listener: () => void) {
			socketListeners.get(event)?.delete(listener)
		},
		on(event: string, listener: () => void) {
			const listeners = socketListeners.get(event) ?? new Set()
			listeners.add(listener)
			socketListeners.set(event, listeners)
		},
		once(event: string, listener: () => void) {
			const once = () => {
				socket.off(event, once)
				listener()
			}
			socket.on(event, once)
		},
	}
	const history: any = {
		refresh: vi.fn(() => Promise.resolve(undefined)),
		request: vi.fn(() => Promise.resolve({ status: `unavailable` })),
		start: vi.fn(() => {
			historyState.snapshot = {
				horizon: { canRedo: false, canUndo: false },
			}
			return Promise.resolve()
		}),
		state: historyState,
		subscribe(listener: () => void) {
			historyListeners.add(listener)
			return () => historyListeners.delete(listener)
		},
	}
	const presence: any = {
		refresh: vi.fn(() => Promise.resolve(undefined)),
		republish: vi.fn(() => Promise.resolve(undefined)),
		start: vi.fn(() => Promise.resolve(undefined)),
		subscribe(listener: () => void) {
			presenceListeners.add(listener)
			return () => presenceListeners.delete(listener)
		},
	}
	const residency: any = {
		reconnect: vi.fn(() => Promise.resolve(undefined)),
		state: residencyState,
		subscribeState(listener: (state: any) => void) {
			residencyListeners.add(listener)
			listener(residencyState)
			return () => residencyListeners.delete(listener)
		},
	}
	return {
		history,
		historyState,
		presence,
		publishRevision(revision: number) {
			residencyState.headRevision = revision
			for (const listener of residencyListeners) listener(residencyState)
		},
		residency,
		socket,
	}
}

describe(`Mosaic Domain session client`, () => {
	test(`synchronizes, serializes commands, and settles resident revisions`, async () => {
		const fixture = sessionFixture({ revision: 1 })
		const sent: string[] = []
		const client = await createMosaicDomainSessionClient({
			...fixture,
			initialSequence: 4,
			send: (command: string) => {
				sent.push(command)
				const revision = sent.length + 1
				queueMicrotask(() => {
					fixture.publishRevision(revision)
				})
				return Promise.resolve({ revision } as never)
			},
			socket: fixture.socket,
		})
		const states: any[] = []
		const unsubscribe = client.subscribe((state) => states.push(state))
		await Promise.all([
			client.submit((sequence) => `first-${sequence}`),
			client.submit((sequence) => `second-${sequence}`),
		])
		expect(sent).toEqual([`first-5`, `second-6`])
		expect(client.sequence).toBe(6)
		expect(client.state()).toMatchObject({ connection: `live`, pending: 0 })
		expect(fixture.history.refresh).toHaveBeenCalledTimes(2)
		expect(states.some(({ pending }) => pending === 2)).toBe(true)
		unsubscribe()
		client[Symbol.dispose]()
	})

	test(`reconnects, exposes local history, and disposes offline waits`, async () => {
		const fixture = sessionFixture({ connected: false })
		fixture.historyState.snapshot = {
			horizon: { canRedo: true, canUndo: true },
		}
		fixture.history.request
			.mockResolvedValueOnce({ status: `accepted` })
			.mockResolvedValueOnce({ status: `rejected`, reason: `stale` })
		const client = await createMosaicDomainSessionClient({
			...fixture,
			send: vi.fn(() => Promise.resolve({ revision: 1 }) as never),
			socket: fixture.socket,
		})
		expect(client.state().connection).toBe(`offline`)
		fixture.socket.connected = true
		fixture.socket.dispatch(`connect`)
		await client.synchronize()
		expect(fixture.residency.reconnect).toHaveBeenCalled()
		await expect(client.history(`undo`)).resolves.toBe(true)
		await expect(client.history(`redo`)).rejects.toThrow(`stale`)

		fixture.socket.connected = false
		const pending = client.submit(() => `offline`)
		client[Symbol.dispose]()
		await expect(pending).rejects.toThrow(`disposed`)
		await expect(client.synchronize()).rejects.toThrow(`disposed`)
	})

	test(`restores pending accounting when command construction fails`, async () => {
		const fixture = sessionFixture()
		const client = await createMosaicDomainSessionClient({
			...fixture,
			send: vi.fn(),
			socket: fixture.socket,
		})
		await expect(
			client.submit(() => {
				throw new Error(`construction failed`)
			}),
		).rejects.toThrow(`construction failed`)
		expect(client.state().pending).toBe(0)
		expect(client.sequence).toBe(1)
	})

	test(`validates limits and times out absent resident settlement`, async () => {
		const fixture = sessionFixture()
		for (const options of [
			{ settlementTimeoutMs: 0 },
			{ initialSequence: -1 },
		]) {
			await expect(
				createMosaicDomainSessionClient({
					...fixture,
					...options,
					send: vi.fn(),
					socket: fixture.socket,
				}),
			).rejects.toThrow(`safe integers`)
		}
		const client = await createMosaicDomainSessionClient({
			...fixture,
			send: () => Promise.resolve({ revision: 2 }) as never,
			settlementTimeoutMs: 5,
			socket: fixture.socket,
		})
		await expect(client.submit(() => `timeout`)).rejects.toThrow(
			`did not settle`,
		)

		const disposing = await createMosaicDomainSessionClient({
			...fixture,
			send: () => Promise.resolve({ revision: 3 }) as never,
			settlementTimeoutMs: 10_000,
			socket: fixture.socket,
		})
		const unsettled = disposing.submit(() => `unsettled`)
		await Promise.resolve()
		disposing[Symbol.dispose]()
		await expect(unsettled).rejects.toThrow(`disposed`)
	})
})
