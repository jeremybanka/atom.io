import type { StandardSchemaV1 } from "@atom.io/realtime"
import { createRigidStateClient } from "@atom.io/realtime/client"
import { createRigidStateServer } from "@atom.io/realtime/server"
import {
	createDeterministicTransport,
	VirtualClock,
} from "@atom.io/realtime/testing/headless"
import { Silo } from "atom.io"
import { getFromStore, setIntoStore } from "atom.io/internal"
import { z } from "zod"

const tick = async () => {
	for (let i = 0; i < 30; i++) await Promise.resolve()
}
function fixture(schema: StandardSchemaV1<unknown, number> = z.number()) {
	const clock = new VirtualClock()
	const transport = createDeterministicTransport({ clock })
	const authority = new Silo({
		name: `authority`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const tokenAtom = authority.atom<number>({ key: `token`, default: 0 })
	const denied = new Set<string>()
	const writeDenied = new Set<string>()
	const server = createRigidStateServer({
		store: authority.store,
		token: tokenAtom,
		schema,
		clock,
		leaseDurationMs: 90,
		authorize: (identity: string, access) =>
			!denied.has(identity) &&
			(access !== `write` || !writeDenied.has(identity)),
	})
	const clients: Array<{ dispose(): void }> = []
	function addClient(id: string, writable = true) {
		const silo = new Silo({
			name: id,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		const valueAtom = silo.atom<number>({ key: `value`, default: -1 })
		const sockets = transport.createDuplex(
			{ id, role: `client` },
			{ id: `${id}-server`, role: `server` },
		)
		const stop = server.connect(sockets.right, id)
		const client = createRigidStateClient({
			store: silo.store,
			token: valueAtom,
			resource: tokenAtom.key,
			socket: sockets.left,
			schema: z.number(),
			clock,
			writable,
		})
		const entry = { client, silo, value: valueAtom, sockets, stop }
		clients.push(client)
		return entry
	}
	return {
		authority,
		token: tokenAtom,
		clock,
		transport,
		denied,
		writeDenied,
		server,
		addClient,
		dispose() {
			for (const client of clients) client.dispose()
			server.dispose()
		},
	}
}

describe(`versioned Rigid state`, () => {
	test(`hydrates aliased state, accepts CAS writes, and preserves single-writer handoff`, async () => {
		const f = fixture()
		const a = f.addClient(`a`)
		const b = f.addClient(`b`)
		await tick()
		expect(a.client.state.status).toBe(`writable`)
		expect(b.client.state.status).toBe(`waiting`)
		const result = a.client.write(1)
		expect(getFromStore(a.silo.store, a.value)).toBe(0)
		await expect(result).resolves.toMatchObject({
			status: `accepted`,
			snapshot: { revision: 1, value: 1 },
		})
		await tick()
		expect(getFromStore(b.silo.store, b.value)).toBe(1)
		a.client.release()
		await tick()
		expect(b.client.state.status).toBe(`writable`)
		await expect(a.client.write(9)).resolves.toMatchObject({
			status: `rejected`,
			problem: { code: `lease-lost` },
		})
		f.dispose()
	})

	test(`rejects a write whose expected revision changes during async validation`, async () => {
		let finish!: (result: { value: number }) => void
		const schema: StandardSchemaV1<unknown, number> = {
			"~standard": {
				vendor: `test`,
				version: 1,
				validate: () =>
					new Promise((resolve) => {
						finish = resolve
					}),
			},
		}
		const f = fixture(schema)
		const a = f.addClient(`a`)
		await tick()
		const result = a.client.write(1)
		await tick()
		setIntoStore(f.authority.store, f.token, 5)
		finish({ value: 1 })
		await expect(result).resolves.toMatchObject({
			status: `rejected`,
			problem: { code: `conflict` },
		})
		await tick()
		expect(getFromStore(a.silo.store, a.value)).toBe(5)
		expect(getFromStore(f.authority.store, f.token)).toBe(5)
		f.dispose()
	})

	test(`fences an expired writer after asynchronous validation`, async () => {
		let finish!: (result: { value: number }) => void
		const f = fixture({
			"~standard": {
				vendor: `test`,
				version: 1,
				validate: () =>
					new Promise((resolve) => {
						finish = resolve
					}),
			},
		})
		const a = f.addClient(`a`)
		const b = f.addClient(`b`)
		await tick()
		const result = a.client.write(7)
		await tick()
		// Suppress client renewals while advancing the server's authority clock.
		f.transport.use({
			effect: { type: `drop` },
			filter: { direction: `client-to-server`, from: `a` },
		})
		f.clock.advance(90)
		await tick()
		finish({ value: 7 })
		await tick()
		expect(getFromStore(f.authority.store, f.token)).toBe(0)
		expect(b.client.state.status).toBe(`writable`)
		await expect(result).resolves.toMatchObject({
			status: `interrupted`,
			outcome: `unknown`,
		})
		f.dispose()
	})

	test(`revokes active reads and rechecks authorization after validation`, async () => {
		let finish!: (result: { value: number }) => void
		const f = fixture({
			"~standard": {
				vendor: `test`,
				version: 1,
				validate: () =>
					new Promise((resolve) => {
						finish = resolve
					}),
			},
		})
		const a = f.addClient(`a`)
		await tick()
		const result = a.client.write(7)
		await tick()
		f.denied.add(`a`)
		f.server.revalidate()
		await tick()
		finish({ value: 7 })
		await expect(result).resolves.toMatchObject({ status: `interrupted` })
		await tick()
		expect(a.client.state.status).toBe(`revoked`)
		setIntoStore(f.authority.store, f.token, 9)
		await tick()
		expect(getFromStore(a.silo.store, a.value)).toBe(0)
		f.dispose()
	})

	test(`rejects malformed values without poisoning the next publication`, async () => {
		const f = fixture(z.number().nonnegative())
		const a = f.addClient(`a`)
		await tick()
		await expect(a.client.write(-1)).resolves.toMatchObject({
			status: `rejected`,
			problem: { code: `invalid` },
		})
		await expect(a.client.write(2)).resolves.toMatchObject({
			status: `accepted`,
		})
		f.dispose()
	})

	test(`restores active subscription with a new epoch after a server restart`, async () => {
		const f = fixture()
		const a = f.addClient(`a`)
		await tick()
		const oldEpoch = a.client.state.snapshot!.epoch
		a.sockets.left.receive(`disconnect`, [])
		f.server.dispose()
		setIntoStore(f.authority.store, f.token, 4)
		const replacement = createRigidStateServer({
			store: f.authority.store,
			token: f.token,
			schema: z.number(),
			clock: f.clock,
			authorize: () => true,
		})
		replacement.connect(a.sockets.right, `a`)
		a.sockets.left.receive(`connect`, [])
		await tick()
		expect(a.client.state.snapshot?.epoch).not.toBe(oldEpoch)
		expect(a.client.state.snapshot?.value).toBe(4)
		expect(a.client.state.status).toBe(`writable`)
		f.dispose()
		replacement.dispose()
	})

	test(`settles lost acknowledgements and disposal with explicit unknown outcome`, async () => {
		const f = fixture()
		const a = f.addClient(`a`)
		await tick()
		f.transport.use({
			effect: { type: `drop` },
			filter: { direction: `server-to-client` },
		})
		const result = a.client.write(7)
		await tick()
		expect(getFromStore(f.authority.store, f.token)).toBe(7)
		a.client.dispose()
		await expect(result).resolves.toEqual({
			status: `interrupted`,
			outcome: `unknown`,
		})
		f.dispose()
	})
})

describe(`Rigid delayed and invalid traffic`, () => {
	test(`state broadcasts do not postpone lease renewal`, async () => {
		const f = fixture()
		const a = f.addClient(`a`)
		await tick()
		const generation = a.client.state.lease!.generation
		for (let i = 1; i <= 12; i++) {
			f.clock.advance(10)
			setIntoStore(f.authority.store, f.token, i)
			await tick()
		}
		expect(a.client.state.status).toBe(`writable`)
		expect(a.client.state.lease!.generation).toBe(generation)
		expect(a.client.state.lease!.expiresAt).toBeGreaterThan(120)
		f.dispose()
	})

	test(`late acknowledgement settles its write without reverting newer state`, async () => {
		const f = fixture()
		const a = f.addClient(`a`)
		await tick()
		f.transport.use({
			effect: { type: `delay`, by: 5 },
			filter: {
				direction: `server-to-client`,
				predicate: ({ args }) =>
					(args[0] as { kind?: string }).kind === `result`,
			},
		})
		const result = a.client.write(1)
		await tick()
		setIntoStore(f.authority.store, f.token, 2)
		await tick()
		f.clock.advance(5)
		await expect(result).resolves.toMatchObject({
			status: `accepted`,
			snapshot: { value: 1 },
		})
		expect(a.client.state.snapshot!.value).toBe(2)
		expect(getFromStore(a.silo.store, a.value)).toBe(2)
		f.dispose()
	})

	test(`out of order complete snapshots cannot revert the client projection`, async () => {
		const f = fixture()
		const a = f.addClient(`a`, false)
		await tick()
		const stop = f.transport.use({
			effect: { type: `delay`, by: 5 },
			filter: { direction: `server-to-client` },
		})
		setIntoStore(f.authority.store, f.token, 1)
		stop()
		setIntoStore(f.authority.store, f.token, 2)
		await tick()
		f.clock.advance(5)
		await tick()
		expect(a.client.state.snapshot!.value).toBe(2)
		expect(a.client.state.status).toBe(`readonly`)
		f.dispose()
	})

	test(`malformed state metadata cannot apply even a schema-valid value`, async () => {
		const f = fixture()
		const a = f.addClient(`a`, false)
		let last: Record<string, unknown> = {}
		a.sockets.left.onAny((_, input) => {
			last = input as Record<string, unknown>
		})
		await tick()
		setIntoStore(f.authority.store, f.token, 1)
		await tick()
		a.sockets.left.receive(`rigid:response:${f.token.key}`, [
			{
				...last,
				delivery: 999,
				status: `writable`,
				lease: null,
				snapshot: {
					epoch: a.client.state.snapshot!.epoch,
					revision: 999,
					value: 999,
				},
			},
		])
		await tick()
		expect(a.client.state.status).toBe(`failed`)
		expect(getFromStore(a.silo.store, a.value)).toBe(1)
		f.dispose()
	})

	test(`disposal while disconnected prevents reconnect restoration`, async () => {
		const f = fixture()
		const a = f.addClient(`a`)
		await tick()
		a.sockets.left.receive(`disconnect`, [])
		a.client.dispose()
		a.sockets.left.receive(`connect`, [])
		await tick()
		expect(a.client.state.status).toBe(`disconnected`)
		f.dispose()
	})
})

describe(`Rigid service ownership`, () => {
	test(`write revocation downgrades a waiting reader immediately`, async () => {
		const f = fixture()
		f.addClient(`a`)
		const b = f.addClient(`b`)
		await tick()
		expect(b.client.state.status).toBe(`waiting`)
		f.writeDenied.add(`b`)
		f.server.revalidate()
		await tick()
		expect(b.client.state.status).toBe(`readonly`)
		f.dispose()
	})

	test(`a broken socket cannot prevent broadcast to healthy clients`, async () => {
		const f = fixture()
		const a = f.addClient(`a`)
		const b = f.addClient(`b`, false)
		await tick()
		a.sockets.right.emit = () => {
			throw new Error(`socket closed`)
		}
		expect(() => {
			setIntoStore(f.authority.store, f.token, 3)
		}).not.toThrow()
		await tick()
		expect(getFromStore(b.silo.store, b.value)).toBe(3)
		f.dispose()
	})

	test(`a duplicate authority cannot grant an independent lease for the same token`, () => {
		const f = fixture()
		expect(() =>
			createRigidStateServer({
				store: f.authority.store,
				token: f.token,
				schema: z.number(),
				authorize: () => true,
			}),
		).toThrow(`already exists`)
		f.dispose()
		const replacement = createRigidStateServer({
			store: f.authority.store,
			token: f.token,
			schema: z.number(),
			authorize: () => true,
		})
		replacement.dispose()
	})
})
