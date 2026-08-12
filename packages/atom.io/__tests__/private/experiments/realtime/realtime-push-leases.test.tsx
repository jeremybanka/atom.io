import { waitFor } from "@testing-library/react"
import { type } from "arktype"
import * as AtomIO from "atom.io"
import type { Json } from "atom.io/foundations/json"
import type {
	RealtimeLeaseStatus,
	Socket,
	StandardSchemaV1,
} from "atom.io/realtime"
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
		clients: { alice: EmptyClient, bob: EmptyClient },
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
})
