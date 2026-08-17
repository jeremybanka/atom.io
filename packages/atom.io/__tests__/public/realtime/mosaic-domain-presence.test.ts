import { Silo } from "atom.io"
import {
	MOSAIC_DOMAIN_PRESENCE_PROTOCOL_VERSION,
	mosaicDomain,
} from "atom.io/realtime"
import {
	createMosaicDomainPresenceClient,
	createMosaicDomainPresenceSocketTransport,
} from "atom.io/realtime-client"
import { createMosaicDomainPresenceServer } from "atom.io/realtime-server"
import { vi } from "vitest"
import { z } from "zod"

const cursorSchema = z
	.object({ x: z.number().finite(), y: z.number().finite() })
	.strict()

async function presenceFixture(name: string) {
	const silo = new Silo({ isProduction: false, lifespan: `ephemeral`, name })
	const cursorAtoms = silo.atomFamily<
		z.infer<typeof cursorSchema> | null,
		string
	>({
		default: null,
		key: `cursor`,
	})
	const durableAtom = silo.atom<number>({ default: 0, key: `durable` })
	const definition = mosaicDomain({
		configSchema: z.object({}).strict(),
		key: `presence-test`,
		members: {
			cursors: {
				keySchema: z.string().min(1),
				role: `ephemeral`,
				schema: cursorSchema,
				token: cursorAtoms,
			},
			durable: { role: `durable`, schema: z.number(), token: durableAtom },
		},
		version: 1,
	})
	const domain = await definition.activate({
		config: {},
		instance: `document`,
		store: silo.store,
	})
	return { cursorAtoms, domain, silo }
}

describe(`Mosaic Domain presence`, () => {
	test(`sessions are independent and stale updates cannot resurrect a clear`, async () => {
		const [serverState, firstState, secondState, observerState] =
			await Promise.all([
				presenceFixture(`presence-server`),
				presenceFixture(`presence-first`),
				presenceFixture(`presence-second`),
				presenceFixture(`presence-observer`),
			])
		const server = createMosaicDomainPresenceServer({
			domain: serverState.domain,
		})
		const firstConnection = server.connect({ actor: `ada`, session: `tab-1` })
		const secondConnection = server.connect({ actor: `ada`, session: `tab-2` })
		const observerConnection = server.connect({
			actor: `grace`,
			session: `watch`,
		})
		const first = createMosaicDomainPresenceClient({
			domain: firstState.domain,
			session: `tab-1`,
			transport: firstConnection,
		})
		const second = createMosaicDomainPresenceClient({
			domain: secondState.domain,
			session: `tab-2`,
			transport: secondConnection,
		})
		const observer = createMosaicDomainPresenceClient({
			domain: observerState.domain,
			session: `watch`,
			transport: observerConnection,
		})
		await Promise.all([first.start(), second.start(), observer.start()])
		const firstKey = `ada\u0000tab-1`
		const secondKey = `ada\u0000tab-2`
		await Promise.all([
			first.publish(firstState.domain.address(`cursors`, firstKey), {
				x: 1,
				y: 2,
			}),
			second.publish(secondState.domain.address(`cursors`, secondKey), {
				x: 3,
				y: 4,
			}),
		])

		expect(
			observerState.silo.getState(observerState.cursorAtoms, firstKey),
		).toEqual({
			x: 1,
			y: 2,
		})
		expect(
			observerState.silo.getState(observerState.cursorAtoms, secondKey),
		).toEqual({
			x: 3,
			y: 4,
		})
		await expect(
			second.publish(secondState.domain.address(`cursors`, firstKey), {
				x: 90,
				y: 90,
			}),
		).rejects.toThrow(`held by another actor-session`)
		expect(
			observerState.silo.getState(observerState.cursorAtoms, firstKey),
		).toEqual({ x: 1, y: 2 })

		await first.clear(firstState.domain.address(`cursors`, firstKey))
		expect(
			observerState.silo.getState(observerState.cursorAtoms, firstKey),
		).toBeNull()
		expect(
			observerState.silo.getState(observerState.cursorAtoms, secondKey),
		).toEqual({
			x: 3,
			y: 4,
		})
		const stale = await firstConnection.publish({
			address: firstState.domain.address(`cursors`, firstKey),
			domain: firstState.domain.identity,
			kind: `update`,
			protocolVersion: MOSAIC_DOMAIN_PRESENCE_PROTOCOL_VERSION,
			sequence: 1,
			session: `tab-1`,
			value: { x: 99, y: 99 },
		})
		expect(stale).toMatchObject({
			rejection: { code: `stale` },
			status: `rejected`,
		})
		expect(
			observerState.silo.getState(observerState.cursorAtoms, firstKey),
		).toBeNull()

		await secondConnection.disconnect()
		await observer.flush()
		expect(
			observerState.silo.getState(observerState.cursorAtoms, secondKey),
		).toBeNull()
		first[Symbol.dispose]()
		second[Symbol.dispose]()
		observer[Symbol.dispose]()
		await firstConnection.disconnect()
		await observerConnection.disconnect()
		server[Symbol.dispose]()
	})

	test(`expiry, validation, rate, payload, and queue limits fail closed`, async () => {
		let now = 10
		const [serverState, clientState] = await Promise.all([
			presenceFixture(`presence-limits-server`),
			presenceFixture(`presence-limits-client`),
		])
		const server = createMosaicDomainPresenceServer({
			domain: serverState.domain,
			limits: { maxBytes: 1_000, maxUpdatesPerSecond: 2 },
			now: () => now,
			ttlMs: 20,
		})
		const connection = server.connect({ actor: `ada`, session: `tab` })
		const cleanup = vi.fn()
		server.subscribeCleanup(cleanup)
		const client = createMosaicDomainPresenceClient({
			domain: clientState.domain,
			session: `tab`,
			transport: connection,
		})
		await client.start()
		const key = `ada\u0000tab`
		await client.publish(clientState.domain.address(`cursors`, key), {
			x: 1,
			y: 1,
		})
		now = 31
		expect(await server.sweepExpired()).toBe(1)
		await client.flush()
		expect(clientState.silo.getState(clientState.cursorAtoms, key)).toBeNull()
		expect(cleanup).toHaveBeenCalledWith(
			expect.objectContaining({ reason: `expired` }),
		)

		const oversized = await connection.publish({
			address: clientState.domain.address(`cursors`, key),
			domain: clientState.domain.identity,
			kind: `update`,
			protocolVersion: MOSAIC_DOMAIN_PRESENCE_PROTOCOL_VERSION,
			sequence: 3,
			session: `tab`,
			value: { padding: `x`.repeat(2_000), x: 1, y: 1 },
		})
		expect(oversized).toMatchObject({
			rejection: { code: `invalid-payload` },
			status: `rejected`,
		})
		const durable = await connection.publish({
			address: clientState.domain.address(`durable`),
			domain: clientState.domain.identity,
			kind: `update`,
			protocolVersion: MOSAIC_DOMAIN_PRESENCE_PROTOCOL_VERSION,
			sequence: 3,
			session: `tab`,
			value: 1,
		})
		expect(durable).toMatchObject({
			rejection: { code: `unauthorized` },
			status: `rejected`,
		})
		const limited = await connection.publish({
			address: clientState.domain.address(`cursors`, key),
			domain: clientState.domain.identity,
			kind: `update`,
			protocolVersion: MOSAIC_DOMAIN_PRESENCE_PROTOCOL_VERSION,
			sequence: 4,
			session: `tab`,
			value: { x: 2, y: 2 },
		})
		expect(limited).toMatchObject({
			rejection: { code: `rate-limited` },
			status: `rejected`,
		})
		client[Symbol.dispose]()
		await connection.disconnect()
		server[Symbol.dispose]()
	})

	test(`client and socket request queues reserve capacity before asynchronous work`, async () => {
		const [serverState, clientState] = await Promise.all([
			presenceFixture(`presence-queue-server`),
			presenceFixture(`presence-queue-client`),
		])
		const server = createMosaicDomainPresenceServer({
			domain: serverState.domain,
		})
		const connection = server.connect({ actor: `ada`, session: `tab` })
		let release: (() => void) | undefined
		const client = createMosaicDomainPresenceClient({
			domain: clientState.domain,
			maxPendingUpdates: 1,
			session: `tab`,
			transport: {
				publish: (proposal) =>
					new Promise((resolve) => {
						release = () => {
							void connection.publish(proposal).then(resolve)
						}
					}),
				snapshot: () => connection.snapshot(),
				subscribe: (listener) => connection.subscribe(listener),
			},
		})
		await client.start()
		const key = `ada\u0000tab`
		const first = client.publish(clientState.domain.address(`cursors`, key), {
			x: 1,
			y: 1,
		})
		await expect(
			client.publish(clientState.domain.address(`cursors`, key), { x: 2, y: 2 }),
		).rejects.toThrow(`queue is full`)
		while (release === undefined) await Promise.resolve()
		release()
		await first

		const socketListeners = new Map<string, Set<(payload: any) => void>>()
		const socket = {
			emit: () => undefined,
			off(event: string, listener?: (payload: any) => void) {
				if (listener === undefined) socketListeners.delete(event)
				else socketListeners.get(event)?.delete(listener)
			},
			on(event: string, listener: (payload: any) => void) {
				const listeners = socketListeners.get(event) ?? new Set()
				listeners.add(listener)
				socketListeners.set(event, listeners)
			},
		}
		const socketTransport = createMosaicDomainPresenceSocketTransport(socket, {
			maxPendingRequests: 1,
		})
		const pendingSnapshot = socketTransport.snapshot()
		await expect(socketTransport.snapshot()).rejects.toThrow(`queue is full`)
		socketTransport[Symbol.dispose]()
		await expect(pendingSnapshot).rejects.toThrow(`disconnected`)
		client[Symbol.dispose]()
		await connection.disconnect()
		server[Symbol.dispose]()
	})

	test(`a reconnect snapshots clears and advances past the retained session cursor`, async () => {
		const [serverState, clientState, observerState] = await Promise.all([
			presenceFixture(`presence-reconnect-server`),
			presenceFixture(`presence-reconnect-client`),
			presenceFixture(`presence-reconnect-observer`),
		])
		const server = createMosaicDomainPresenceServer({
			domain: serverState.domain,
		})
		let current = server.connect({ actor: `ada`, session: `tab` })
		const relays = new Set<Parameters<typeof current.subscribe>[0]>()
		let unrelay = current.subscribe((presence) => {
			for (const relay of relays) relay(presence)
		})
		const transport = {
			publish: (proposal: Parameters<typeof current.publish>[0]) =>
				current.publish(proposal),
			snapshot: () => current.snapshot(),
			subscribe(listener: Parameters<typeof current.subscribe>[0]) {
				relays.add(listener)
				return () => relays.delete(listener)
			},
		}
		const observerConnection = server.connect({
			actor: `grace`,
			session: `watch`,
		})
		const client = createMosaicDomainPresenceClient({
			domain: clientState.domain,
			session: `tab`,
			transport,
		})
		const observer = createMosaicDomainPresenceClient({
			domain: observerState.domain,
			session: `watch`,
			transport: observerConnection,
		})
		await Promise.all([client.start(), observer.start()])
		const key = `ada\u0000tab`
		await client.publish(clientState.domain.address(`cursors`, key), {
			x: 1,
			y: 1,
		})
		await current.disconnect()
		unrelay()
		current = server.connect({ actor: `ada`, session: `tab` })
		unrelay = current.subscribe((presence) => {
			for (const relay of relays) relay(presence)
		})

		await client.publish(clientState.domain.address(`cursors`, key), {
			x: 2,
			y: 2,
		})
		await observer.flush()
		expect(client.state.status).toBe(`live`)
		expect(clientState.silo.getState(clientState.cursorAtoms, key)).toEqual({
			x: 2,
			y: 2,
		})
		expect(observerState.silo.getState(observerState.cursorAtoms, key)).toEqual({
			x: 2,
			y: 2,
		})
		client[Symbol.dispose]()
		observer[Symbol.dispose]()
		unrelay()
		await current.disconnect()
		await observerConnection.disconnect()
		server[Symbol.dispose]()
	})
})
