import { waitFor } from "@testing-library/react"
import { type } from "arktype"
import * as AtomIO from "atom.io"
import type { Json } from "atom.io/foundations/json"
import { IMPLICIT } from "atom.io/internal"
import type {
	RealtimeLeaseStatus,
	Socket,
	StandardSchemaV1,
} from "atom.io/realtime"
import { mutexAtoms, realtimeLeaseAtoms } from "atom.io/realtime"
import * as RTC from "atom.io/realtime-client"
import * as RTS from "atom.io/realtime-server"
import * as RTTest from "atom.io/realtime-testing"
import * as React from "react"

const countAtom = AtomIO.atom<number>({ key: `count`, default: 0 })
const serverCountAtom = AtomIO.atom<number>({ key: `serverCount`, default: 0 })

class ManualClock implements RTS.RealtimeLeaseClock {
	private current = 0
	private nextId = 0
	private jobs = new Map<number, { at: number; callback: () => void }>()

	public now = (): number => this.current
	public setTimeout = (callback: () => void, milliseconds: number): number => {
		const id = ++this.nextId
		this.jobs.set(id, { at: this.current + milliseconds, callback })
		return id
	}
	public clearTimeout = (id: unknown): void => {
		this.jobs.delete(id as number)
	}
	public advance(milliseconds: number): void {
		const target = this.current + milliseconds
		while (true) {
			const next = [...this.jobs].sort((a, b) => a[1].at - b[1].at)[0]
			if (next === undefined || next[1].at > target) break
			this.current = next[1].at
			this.jobs.delete(next[0])
			next[1].callback()
		}
		this.current = target
	}
}

const EmptyClient = () => <div />

class TestSocket implements Socket {
	public id = `test-socket`
	public emitted: Array<[string, ...Json.Serializable[]]> = []
	private listeners = new Map<
		string,
		Set<(...args: Json.Serializable[]) => void>
	>()

	public on(
		event: string,
		listener: (...args: Json.Serializable[]) => void,
	): void {
		let listeners = this.listeners.get(event)
		if (listeners === undefined) {
			listeners = new Set()
			this.listeners.set(event, listeners)
		}
		listeners.add(listener)
	}
	public off(
		event: string,
		listener?: (...args: Json.Serializable[]) => void,
	): void {
		if (listener) this.listeners.get(event)?.delete(listener)
		else this.listeners.delete(event)
	}
	public emit(event: string, ...args: Json.Serializable[]): void {
		this.emitted.push([event, ...args])
	}
	public receive(event: string, ...args: Json.Serializable[]): void {
		this.listeners.get(event)?.forEach((listener) => {
			listener(...args)
		})
	}
	public onAny(): void {}
	public onAnyOutgoing(): void {}
	public offAny(): void {}
}

function nextStatus(
	socket: Socket,
	state: RealtimeLeaseStatus[`state`],
): Promise<RealtimeLeaseStatus> {
	return new Promise((resolve) => {
		const listener = (status: RealtimeLeaseStatus) => {
			if (status.state !== state) return
			socket.off(`lease-status:${countAtom.key}`, listener)
			resolve(status)
		}
		socket.on(`lease-status:${countAtom.key}`, listener)
	})
}

function publish(
	socket: Socket,
	lease: Extract<RealtimeLeaseStatus, { state: `owned` }>,
	sequence: number,
	value: number,
): void {
	socket.emit(`pub:${countAtom.key}`, {
		generation: lease.generation,
		leaseId: lease.leaseId,
		sequence,
		value,
	})
}

function scenario(
	clock: ManualClock,
	schema: StandardSchemaV1<unknown, number> = type(`number`),
) {
	return RTTest.multiClient({
		server: ({ socket, userKey, silo: { store } }) =>
			RTS.realtimeStateReceiver({ socket, consumer: userKey, store })(
				schema,
				countAtom,
				serverCountAtom,
				{
					leaseClock: clock,
					leaseDurationMs: 90,
					renewAfterMs: 30,
				},
			),
		clients: { alice: EmptyClient, bob: EmptyClient, charlie: EmptyClient },
	})
}

async function connected(setup: ReturnType<typeof scenario>): Promise<{
	alice: RTTest.RealtimeTestClient
	bob: RTTest.RealtimeTestClient
}> {
	const alice = setup.clients.alice.init()
	const bob = setup.clients.bob.init()
	await waitFor(() => {
		expect(alice.socket.connected).toBe(true)
	})
	await waitFor(() => {
		expect(bob.socket.connected).toBe(true)
	})
	return { alice, bob }
}

describe(`realtime push leases`, () => {
	test(`hands ownership to a FIFO waiter when the owner disconnects`, async () => {
		const setup = scenario(new ManualClock())
		const { alice, bob } = await connected(setup)
		const aliceOwned = nextStatus(alice.socket, `owned`)
		alice.socket.emit(`claim:${countAtom.key}`)
		await aliceOwned

		const bobWaiting = nextStatus(bob.socket, `waiting`)
		bob.socket.emit(`claim:${countAtom.key}`)
		expect(await bobWaiting).toMatchObject({ position: 1 })
		const bobOwned = nextStatus(bob.socket, `owned`)
		alice.socket.disconnect()
		const lease = await bobOwned
		expect(lease).toMatchObject({ generation: 2 })
		await setup.teardown()
	})

	test(`expires, renews, and fences a former owner's delayed publication`, async () => {
		const clock = new ManualClock()
		const validations = new Map<number, (result: { value: number }) => void>()
		const schema: StandardSchemaV1<unknown, number> = {
			"~standard": {
				validate: (input) =>
					new Promise((resolve) => {
						validations.set(input as number, resolve)
					}),
				vendor: `lease-test`,
				version: 1,
			},
		}
		const setup = scenario(clock, schema)
		const { alice, bob } = await connected(setup)
		const aliceOwned = nextStatus(alice.socket, `owned`)
		alice.socket.emit(`claim:${countAtom.key}`)
		const firstLease = (await aliceOwned) as Extract<
			RealtimeLeaseStatus,
			{ state: `owned` }
		>
		const bobWaiting = nextStatus(bob.socket, `waiting`)
		bob.socket.emit(`claim:${countAtom.key}`)
		await bobWaiting
		publish(alice.socket, firstLease, 1, 1)
		await waitFor(() => {
			expect(validations.has(1)).toBe(true)
		})

		const renewed = nextStatus(alice.socket, `owned`)
		clock.advance(60)
		alice.socket.emit(`renew:${countAtom.key}`, {
			generation: firstLease.generation,
			leaseId: firstLease.leaseId,
		})
		await renewed
		clock.advance(60)
		expect(setup.server.silo.getState(serverCountAtom)).toBe(0)

		const bobOwned = nextStatus(bob.socket, `owned`)
		clock.advance(31)
		const secondLease = (await bobOwned) as Extract<
			RealtimeLeaseStatus,
			{ state: `owned` }
		>
		expect(secondLease.generation).toBeGreaterThan(firstLease.generation)

		validations.get(1)!({ value: 1 })
		await Promise.resolve()
		expect(setup.server.silo.getState(serverCountAtom)).toBe(0)

		publish(alice.socket, firstLease, 2, 99)
		publish(bob.socket, secondLease, 1, 2)
		await waitFor(() => {
			expect(validations.has(2)).toBe(true)
		})
		validations.get(2)!({ value: 2 })
		await waitFor(() => {
			expect(setup.server.silo.getState(serverCountAtom)).toBe(2)
		})
		await setup.teardown()
	})

	test(`commits concurrently validated publications in receive order`, async () => {
		const clock = new ManualClock()
		const validations = new Map<number, (result: { value: number }) => void>()
		const schema: StandardSchemaV1<unknown, number> = {
			"~standard": {
				validate: (input) =>
					new Promise((resolve) => {
						validations.set(input as number, resolve)
					}),
				vendor: `ordering-test`,
				version: 1,
			},
		}
		const setup = scenario(clock, schema)
		const { alice } = await connected(setup)
		const owned = nextStatus(alice.socket, `owned`)
		alice.socket.emit(`claim:${countAtom.key}`)
		const lease = (await owned) as Extract<
			RealtimeLeaseStatus,
			{ state: `owned` }
		>
		publish(alice.socket, lease, 1, 1)
		publish(alice.socket, lease, 2, 2)
		await waitFor(() => {
			expect(validations.size).toBe(2)
		})

		validations.get(2)!({ value: 2 })
		await Promise.resolve()
		expect(setup.server.silo.getState(serverCountAtom)).toBe(0)
		validations.get(1)!({ value: 1 })
		await waitFor(() => {
			expect(setup.server.silo.getState(serverCountAtom)).toBe(2)
		})
		await setup.teardown()
	})

	test(`rejects stale control messages and supports legacy publications`, async () => {
		const setup = scenario(new ManualClock())
		const { alice, bob } = await connected(setup)
		const aliceOwned = nextStatus(alice.socket, `owned`)
		alice.socket.emit(`claim:${countAtom.key}`)
		const lease = (await aliceOwned) as Extract<
			RealtimeLeaseStatus,
			{ state: `owned` }
		>

		const duplicateOwned = nextStatus(alice.socket, `owned`)
		alice.socket.emit(`claim:${countAtom.key}`)
		expect(await duplicateOwned).toMatchObject({ generation: lease.generation })
		const bobWaiting = nextStatus(bob.socket, `waiting`)
		bob.socket.emit(`claim:${countAtom.key}`)
		await bobWaiting
		const duplicateWaiting = nextStatus(bob.socket, `waiting`)
		bob.socket.emit(`claim:${countAtom.key}`)
		expect(await duplicateWaiting).toMatchObject({ position: 1 })
		bob.socket.emit(`unclaim:${countAtom.key}`)
		const waitingAgain = nextStatus(bob.socket, `waiting`)
		bob.socket.emit(`claim:${countAtom.key}`)
		await waitingAgain

		const staleRenew = nextStatus(alice.socket, `released`)
		alice.socket.emit(`renew:${countAtom.key}`, {
			generation: lease.generation + 1,
			leaseId: lease.leaseId,
		})
		expect(await staleRenew).toMatchObject({ reason: `stale` })
		const staleRelease = nextStatus(alice.socket, `released`)
		alice.socket.emit(`unclaim:${countAtom.key}`, {
			generation: lease.generation,
			leaseId: `wrong`,
		})
		expect(await staleRelease).toMatchObject({ reason: `stale` })
		const sequenceRejection = nextStatus(alice.socket, `released`)
		publish(alice.socket, lease, 2, 2)
		expect(await sequenceRejection).toMatchObject({ reason: `stale` })

		bob.socket.emit(`pub:${countAtom.key}`, 99)
		alice.socket.emit(`pub:${countAtom.key}`, 7)
		await waitFor(() => {
			expect(setup.server.silo.getState(serverCountAtom)).toBe(7)
		})
		const bobOwned = nextStatus(bob.socket, `owned`)
		alice.socket.emit(`unclaim:${countAtom.key}`, lease)
		await bobOwned
		bob.socket.emit(`unclaim:${countAtom.key}`)
		await setup.teardown()
	})

	test(`logs and ignores schema-invalid publications`, async () => {
		const setup = scenario(new ManualClock())
		const { alice } = await connected(setup)
		const error = vitest.spyOn(setup.server.silo.store.logger, `error`)
		const owned = nextStatus(alice.socket, `owned`)
		alice.socket.emit(`claim:${countAtom.key}`)
		const lease = (await owned) as Extract<
			RealtimeLeaseStatus,
			{ state: `owned` }
		>
		alice.socket.emit(`pub:${countAtom.key}`, {
			generation: lease.generation,
			leaseId: lease.leaseId,
			sequence: 1,
			value: `not a number`,
		})
		await waitFor(() => {
			expect(error).toHaveBeenCalled()
		})
		expect(setup.server.silo.getState(serverCountAtom)).toBe(0)
		await setup.teardown()
	})

	test(`push client renews, publishes metadata, stops, and supports legacy servers`, async () => {
		vitest.useFakeTimers()
		const silo = new AtomIO.Silo(
			{
				isProduction: false,
				lifespan: `ephemeral`,
				name: `LEASE-CLIENT`,
			},
			IMPLICIT.STORE,
		)
		const socket = new TestSocket()
		const dispose = RTC.pushState(silo.store, socket, countAtom)
		expect(socket.emitted).toContainEqual([`claim:${countAtom.key}`])
		const lease = {
			expiresAt: 90,
			generation: 1,
			leaseId: `test-socket:1`,
			renewAfterMs: 30,
			state: `owned`,
		} satisfies RealtimeLeaseStatus
		socket.receive(`lease-status:${countAtom.key}`, lease)
		silo.setState(countAtom, 4)
		expect(socket.emitted.at(-1)).toEqual([
			`pub:${countAtom.key}`,
			{ generation: 1, leaseId: `test-socket:1`, sequence: 1, value: 4 },
		])
		await vitest.advanceTimersByTimeAsync(30)
		expect(socket.emitted.at(-1)).toEqual([
			`renew:${countAtom.key}`,
			{ generation: 1, leaseId: `test-socket:1` },
		])
		socket.receive(`lease-status:${countAtom.key}`, lease)
		const renewals = socket.emitted.filter(([event]) =>
			event.startsWith(`renew:`),
		).length
		socket.receive(`disconnect`)
		expect(silo.getState(mutexAtoms, countAtom.key)).toBe(false)
		expect(silo.getState(realtimeLeaseAtoms, countAtom.key)).toEqual({
			state: `idle`,
		})
		await vitest.advanceTimersByTimeAsync(60)
		expect(
			socket.emitted.filter(([event]) => event.startsWith(`renew:`)),
		).toHaveLength(renewals)
		const publications = socket.emitted.filter(([event]) =>
			event.startsWith(`pub:`),
		).length
		silo.setState(countAtom, 5)
		expect(
			socket.emitted.filter(([event]) => event.startsWith(`pub:`)),
		).toHaveLength(publications)
		dispose()
		await vitest.advanceTimersByTimeAsync(50)
		expect(socket.emitted.at(-1)).toEqual([`unclaim:${countAtom.key}`])

		const legacySocket = new TestSocket()
		const disposeLegacy = RTC.pushState(silo.store, legacySocket, countAtom)
		legacySocket.receive(`claim-result:${countAtom.key}`, true)
		silo.setState(countAtom, 6)
		expect(legacySocket.emitted.at(-1)).toEqual([`pub:${countAtom.key}`, 6])
		disposeLegacy()
		await vitest.advanceTimersByTimeAsync(50)
		vitest.useRealTimers()
	})
})
