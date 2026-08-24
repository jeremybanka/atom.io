import { Silo } from "atom.io"
import {
	assertMosaicDomainPresenceProposal,
	MOSAIC_DOMAIN_PRESENCE_EVENTS,
	MOSAIC_DOMAIN_PRESENCE_PROTOCOL_VERSION,
	mosaicDomain,
	type MosaicDomainPresenceEnvelope,
	type MosaicDomainPresenceProposal,
} from "atom.io/realtime"
import {
	createMosaicDomainPresenceClient,
	createMosaicDomainPresenceSocketTransport,
} from "atom.io/realtime-client"
import {
	bindMosaicDomainPresenceServerSocket,
	createMosaicDomainPresenceServer,
	type MosaicDomainPresenceConnection,
	type MosaicDomainPresenceWorkTracker,
} from "atom.io/realtime-server"
import { vi } from "vitest"
import { z } from "zod"

const cursorSchema = z
	.object({ x: z.number().finite(), y: z.number().finite() })
	.strict()

async function presenceFixture(
	name: string,
	options: { readonly normalizeKeys?: boolean } = {},
) {
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
				keySchema:
					options.normalizeKeys === true
						? z
								.string()
								.min(1)
								.transform((key) => key.trim().toLowerCase())
						: z.string().min(1),
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

function updateProposal(
	domain: Awaited<ReturnType<typeof presenceFixture>>[`domain`],
	options: {
		readonly key?: string
		readonly sequence?: number
		readonly session?: string
		readonly value?: unknown
	} = {},
): MosaicDomainPresenceProposal {
	return {
		address: domain.address(`cursors`, options.key ?? `ada\u0000tab`),
		domain: domain.identity,
		kind: `update`,
		protocolVersion: MOSAIC_DOMAIN_PRESENCE_PROTOCOL_VERSION,
		sequence: options.sequence ?? 1,
		session: options.session ?? `tab`,
		value: (options.value ?? { x: 1, y: 1 }) as never,
	}
}

function fakeSocket() {
	const listeners = new Map<string, Set<(payload: any) => void>>()
	const emitted: Array<{ readonly event: string; readonly payload: any }> = []
	return {
		dispatch(event: string, payload?: any) {
			for (const listener of listeners.get(event) ?? []) listener(payload)
		},
		emitted,
		listeners,
		socket: {
			emit(event: string, payload: any) {
				emitted.push({ event, payload })
			},
			off(event: string, listener?: (payload: any) => void) {
				if (listener === undefined) listeners.delete(event)
				else listeners.get(event)?.delete(listener)
			},
			on(event: string, listener: (payload: any) => void) {
				const current = listeners.get(event) ?? new Set()
				current.add(listener)
				listeners.set(event, current)
			},
		},
	}
}

describe(`Mosaic Domain presence`, () => {
	test(`renews the latest local value and stops renewal on clear or disposal`, async () => {
		vi.useFakeTimers()
		const fixture = await presenceFixture(`presence-renewal`)
		const proposals: MosaicDomainPresenceProposal[] = []
		let rejectNext = false
		const client = createMosaicDomainPresenceClient({
			domain: fixture.domain,
			renewalMs: 10,
			session: `tab`,
			transport: {
				publish(proposal) {
					proposals.push(structuredClone(proposal))
					if (rejectNext) {
						rejectNext = false
						return Promise.resolve({
							rejection: {
								code: `rate-limited`,
								reason: `retry later`,
								recovery: `retry`,
								sequence: proposal.sequence,
							},
							status: `rejected`,
						})
					}
					return Promise.resolve({
						accepted: {
							...structuredClone(proposal),
							actor: `ada`,
							expiresAt: proposal.kind === `update` ? Date.now() + 100 : null,
						},
						status: `accepted`,
					})
				},
				snapshot() {
					return Promise.resolve({ presence: [], sequence: 0 })
				},
				subscribe() {
					return () => undefined
				},
			},
		})
		await client.start()
		const address = fixture.domain.address(`cursors`, `ada\u0000tab`)
		await client.publish(address, { x: 1, y: 2 })
		expect(proposals).toHaveLength(1)
		await vi.advanceTimersByTimeAsync(25)
		expect(proposals.length).toBeGreaterThanOrEqual(3)
		const beforeClear = proposals.length
		await client.clear(address)
		await vi.advanceTimersByTimeAsync(25)
		expect(proposals).toHaveLength(beforeClear + 1)
		await client.publish(address, { x: 3, y: 4 })
		await client.republish()
		expect(proposals.at(-1)).toMatchObject({ value: { x: 3, y: 4 } })
		rejectNext = true
		await expect(client.publish(address, { x: 9, y: 9 })).rejects.toThrow(
			`retry later`,
		)
		await vi.advanceTimersByTimeAsync(10)
		expect(proposals.at(-1)).toMatchObject({ value: { x: 9, y: 9 } })
		client[Symbol.dispose]()
		const beforeDispose = proposals.length
		await vi.advanceTimersByTimeAsync(25)
		expect(proposals).toHaveLength(beforeDispose)
		expect(() =>
			createMosaicDomainPresenceClient({
				domain: fixture.domain,
				renewalMs: 0,
				session: `invalid`,
				transport: {
					publish: () => Promise.reject(new Error(`unused`)),
					snapshot: () => Promise.resolve({ presence: [], sequence: 0 }),
					subscribe: () => () => undefined,
				},
			}),
		).toThrow(`positive integers`)
		vi.useRealTimers()
	})

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

	test(`the wire proposal boundary rejects ambiguous and non-JSON payloads`, async () => {
		const fixture = await presenceFixture(`presence-wire-boundary`)
		const valid = updateProposal(fixture.domain)
		expect(() => {
			assertMosaicDomainPresenceProposal(valid)
		}).not.toThrow()
		expect(() => {
			assertMosaicDomainPresenceProposal({
				...valid,
				value: [null, true, `json`, 1, { nested: [2] }],
			})
		}).not.toThrow()
		for (const [candidate, message] of [
			[null, `must be an object`],
			[{ ...valid, protocolVersion: 2 }, `protocol version`],
			[{ ...valid, session: `` }, `session ID`],
			[{ ...valid, session: `x`.repeat(513) }, `session ID`],
			[{ ...valid, sequence: 0 }, `positive integer`],
			[{ ...valid, sequence: 1.5 }, `positive integer`],
			[{ ...valid, kind: `move` }, `kind is invalid`],
			[
				{
					address: valid.address,
					domain: valid.domain,
					kind: `update`,
					protocolVersion: valid.protocolVersion,
					sequence: 1,
					session: `tab`,
				},
				`requires a value`,
			],
			[{ ...valid, kind: `clear`, value: null }, `cannot carry a value`],
			[{ ...valid, value: Number.NaN }, `JSON-serializable`],
			[{ ...valid, value: new Date() }, `JSON-serializable`],
			[{ ...valid, value: () => undefined }, `JSON-serializable`],
		] as const) {
			expect(() => {
				assertMosaicDomainPresenceProposal(candidate)
			}).toThrow(message)
		}
		const circular: Record<string, unknown> = {}
		circular[`self`] = circular
		expect(() => {
			assertMosaicDomainPresenceProposal({ ...valid, value: circular })
		}).toThrow(`JSON-serializable`)
		const throwingJson = { x: 1, y: 1 }
		Object.defineProperty(throwingJson, `toJSON`, {
			enumerable: false,
			value: () => {
				throw new Error(`serialization failed`)
			},
		})
		expect(() => {
			assertMosaicDomainPresenceProposal({ ...valid, value: throwingJson })
		}).toThrow(`JSON-serializable`)
		expect(() => {
			assertMosaicDomainPresenceProposal(
				{ ...valid, value: { x: 1, y: 1, padding: `x`.repeat(100) } },
				{ maxBytes: 10 },
			)
		}).toThrow(`exceeds 10 bytes`)
		const stringify = vi
			.spyOn(JSON, `stringify`)
			.mockImplementationOnce(() => undefined as never)
		expect(() => {
			assertMosaicDomainPresenceProposal(valid)
		}).toThrow(`JSON-serializable`)
		stringify.mockRestore()
		fixture.domain[Symbol.dispose]()
	})

	test(`server authentication, addressing, lifecycle, and capacity fail closed`, async () => {
		let now = 0
		const fixture = await presenceFixture(`presence-server-adversarial`)
		expect(() =>
			createMosaicDomainPresenceServer({ domain: fixture.domain, ttlMs: 0 }),
		).toThrow(`ttlMs`)
		expect(() =>
			createMosaicDomainPresenceServer({
				domain: fixture.domain,
				limits: { maxSessions: 0 },
			}),
		).toThrow(`maxSessions`)
		const server = createMosaicDomainPresenceServer({
			domain: fixture.domain,
			limits: { maxSessions: 1, maxUpdatesPerSecond: 1 },
			now: () => now,
		})
		expect(() => server.connect({ actor: ``, session: `tab` })).toThrow(
			`actor and session IDs`,
		)
		const connection = server.connect({ actor: `ada`, session: `tab` })
		expect(() => server.connect({ actor: `ada`, session: `tab` })).toThrow(
			`already connected`,
		)
		expect(() => server.connect({ actor: `grace`, session: `watch` })).toThrow(
			`capacity is exhausted`,
		)
		expect(server.forgetSession(`ada`, `tab`)).toBe(false)
		expect(server.forgetSession(`missing`, `tab`)).toBe(false)

		const logger = vi
			.spyOn(fixture.domain.store.logger, `error`)
			.mockImplementation(() => undefined)
		const observed = vi.fn()
		connection.subscribe(() => {
			throw new Error(`observer failed`)
		})
		connection.subscribe(observed)
		const cleanup = server.subscribeCleanup(() => {
			throw new Error(`cleanup failed`)
		})
		expect(
			(await connection.publish(updateProposal(fixture.domain))).status,
		).toBe(`accepted`)
		expect(observed).toHaveBeenCalledOnce()
		expect(logger).toHaveBeenCalled()

		now = 1_001
		expect(
			await connection.publish(
				updateProposal(fixture.domain, { sequence: 2, session: `other` }),
			),
		).toMatchObject({ rejection: { code: `unauthorized` } })
		now = 2_002
		expect(
			await connection.publish({
				...updateProposal(fixture.domain, { sequence: 2 }),
				domain: { ...fixture.domain.identity, instance: `other` },
			}),
		).toMatchObject({ rejection: { code: `invalid-payload` } })
		now = 3_003
		expect(
			await connection.publish({
				...updateProposal(fixture.domain, { sequence: 2 }),
				address: {
					...fixture.domain.address(`cursors`, `ada`),
					member: `unknown`,
				},
			}),
		).toMatchObject({ rejection: { code: `invalid-payload` } })
		now = 4_004
		expect(
			await connection.publish({
				...updateProposal(fixture.domain, { sequence: 2 }),
				address: fixture.domain.address(`durable`),
				value: 1,
			}),
		).toMatchObject({ rejection: { code: `unauthorized` } })
		now = 5_005
		expect(
			await connection.publish(
				updateProposal(fixture.domain, {
					sequence: 2,
					value: { x: `bad`, y: 1 },
				}),
			),
		).toMatchObject({ rejection: { code: `invalid-payload` } })
		expect(
			await connection.publish({
				...updateProposal(fixture.domain, { sequence: 2 }),
				protocolVersion: 2,
			} as never),
		).toMatchObject({ rejection: { code: `incompatible-version` } })
		expect(
			await connection.publish(updateProposal(fixture.domain, { sequence: 2 })),
		).toMatchObject({ rejection: { code: `rate-limited` } })

		now = 6_006
		expect(
			await connection.publish({
				address: fixture.domain.address(`cursors`, `ada\u0000tab`),
				domain: fixture.domain.identity,
				kind: `clear`,
				protocolVersion: MOSAIC_DOMAIN_PRESENCE_PROTOCOL_VERSION,
				sequence: 2,
				session: `tab`,
			}),
		).toMatchObject({ status: `accepted` })
		expect((await connection.snapshot()).presence).toEqual([])
		now = 7_007
		expect(
			await connection.publish(updateProposal(fixture.domain, { sequence: 3 })),
		).toMatchObject({ status: `accepted` })
		await connection.disconnect()
		await connection.disconnect()
		cleanup()
		expect(server.forgetSession(`ada`, `tab`)).toBe(true)
		expect(server.forgetSession(`ada`, `tab`)).toBe(false)
		server[Symbol.dispose]()
		server[Symbol.dispose]()
		expect(() => server.connect({ actor: `ada`, session: `new` })).toThrow(
			`disposed`,
		)
		expect(
			await connection.publish(updateProposal(fixture.domain, { sequence: 3 })),
		).toMatchObject({ rejection: { code: `unauthorized` } })
		await expect(connection.snapshot()).rejects.toThrow(`closed`)
		fixture.domain[Symbol.dispose]()
	})

	test(`server backpressure and disposal win over in-flight validation`, async () => {
		const fixture = await presenceFixture(`presence-server-backpressure`)
		const originalValidate = fixture.domain.validateValue.bind(fixture.domain)
		let release: (() => void) | undefined
		let validationCount = 0
		vi.spyOn(fixture.domain, `validateValue`).mockImplementation(
			async (...parameters) => {
				if (validationCount++ === 0) {
					await new Promise<void>((resolve) => {
						release = resolve
					})
				}
				return originalValidate(...parameters)
			},
		)
		const server = createMosaicDomainPresenceServer({
			domain: fixture.domain,
			limits: { maxPendingUpdates: 2 },
		})
		const connection = server.connect({ actor: `ada`, session: `tab` })
		const pending = connection.publish(updateProposal(fixture.domain))
		const queued = connection.publish(
			updateProposal(fixture.domain, { sequence: 2 }),
		)
		const queuedSnapshot = connection.snapshot()
		const queuedSnapshotAssertion =
			expect(queuedSnapshot).rejects.toThrow(`closed`)
		expect(
			await connection.publish(updateProposal(fixture.domain, { sequence: 3 })),
		).toMatchObject({ rejection: { code: `backpressure` } })
		while (release === undefined) await Promise.resolve()
		server[Symbol.dispose]()
		release()
		expect(await pending).toMatchObject({ rejection: { code: `unauthorized` } })
		expect(await queued).toMatchObject({ rejection: { code: `unauthorized` } })
		await queuedSnapshotAssertion
		await expect(connection.snapshot()).rejects.toThrow(`closed`)
		fixture.domain[Symbol.dispose]()
	})

	test(`client snapshots canonicalize addresses and disposal clears projections`, async () => {
		const fixture = await presenceFixture(`presence-client-canonical`, {
			normalizeKeys: true,
		})
		const rawAddress = fixture.domain.address(`cursors`, ` ADA `)
		const envelope: MosaicDomainPresenceEnvelope = {
			actor: `ada`,
			address: rawAddress,
			domain: fixture.domain.identity,
			expiresAt: 100,
			kind: `update`,
			protocolVersion: MOSAIC_DOMAIN_PRESENCE_PROTOCOL_VERSION,
			sequence: 1,
			session: `tab`,
			value: { x: 3, y: 4 },
		}
		const replacement: MosaicDomainPresenceEnvelope = {
			...envelope,
			actor: `grace`,
			sequence: 1,
			session: `watch`,
			value: { x: 7, y: 8 },
		}
		let failSnapshot = true
		let snapshotPresence = [envelope]
		let relay: ((presence: MosaicDomainPresenceEnvelope) => void) | undefined
		const client = createMosaicDomainPresenceClient({
			domain: fixture.domain,
			session: `tab`,
			transport: {
				publish: () =>
					Promise.resolve({ accepted: envelope, status: `accepted` }),
				snapshot: () => {
					if (failSnapshot) return Promise.reject(new Error(`offline`))
					return Promise.resolve({ presence: snapshotPresence, sequence: 1 })
				},
				subscribe(listener) {
					relay = listener
					return () => {
						relay = undefined
					}
				},
			},
		})
		await expect(client.start()).rejects.toThrow(`offline`)
		expect(client.state.status).toBe(`offline`)
		failSnapshot = false
		await client.start()
		expect(fixture.silo.getState(fixture.cursorAtoms, `ada`)).toEqual({
			x: 3,
			y: 4,
		})
		snapshotPresence = [replacement]
		await client.refresh()
		expect(fixture.silo.getState(fixture.cursorAtoms, `ada`)).toEqual({
			x: 7,
			y: 8,
		})
		expect(client.state.presence).toEqual([
			expect.objectContaining({ actor: `grace`, session: `watch` }),
		])
		relay?.({
			...envelope,
			expiresAt: null,
			kind: `clear`,
			sequence: 2,
		})
		await client.flush()
		expect(fixture.silo.getState(fixture.cursorAtoms, `ada`)).toEqual({
			x: 7,
			y: 8,
		})
		const logger = vi
			.spyOn(fixture.domain.store.logger, `error`)
			.mockImplementation(() => undefined)
		const observed = vi.fn()
		client.subscribe(() => {
			throw new Error(`listener failed`)
		})
		client.subscribe(observed)
		relay?.({ ...envelope, sequence: 3, value: { x: 5, y: 6 } })
		await client.flush()
		expect(fixture.silo.getState(fixture.cursorAtoms, `ada`)).toEqual({
			x: 5,
			y: 6,
		})
		expect(observed).toHaveBeenCalled()
		expect(logger).toHaveBeenCalled()
		client[Symbol.dispose]()
		expect(fixture.silo.getState(fixture.cursorAtoms, `ada`)).toBeNull()
		expect(client.state).toMatchObject({ presence: [], status: `disposed` })
		await expect(client.start()).rejects.toThrow(`disposed`)
		await expect(client.publish(rawAddress, { x: 1, y: 1 })).rejects.toThrow(
			`disposed`,
		)
		client[Symbol.dispose]()
		fixture.domain[Symbol.dispose]()
	})

	test(`client rejects malformed transport data and reports non-stale failures`, async () => {
		const fixture = await presenceFixture(`presence-client-adversarial`)
		const relay = { current: (_presence: MosaicDomainPresenceEnvelope) => {} }
		let invalidSnapshot = true
		let rejectPublish = true
		const client = createMosaicDomainPresenceClient({
			domain: fixture.domain,
			session: `tab`,
			transport: {
				publish: async (proposal) =>
					rejectPublish
						? {
								rejection: {
									code: `unauthorized`,
									reason: `denied`,
									recovery: `discard-update`,
									sequence: proposal.sequence,
								},
								status: `rejected`,
							}
						: Promise.reject(new Error(`network down`)),
				snapshot: () =>
					Promise.resolve(
						invalidSnapshot
							? ({ presence: null, sequence: -1 } as never)
							: { presence: [], sequence: 0 },
					),
				subscribe(listener) {
					relay.current = listener
					return () => undefined
				},
			},
		})
		await expect(client.start()).rejects.toThrow(`invalid snapshot`)
		invalidSnapshot = false
		await client.start()
		await expect(
			client.publish(fixture.domain.address(`durable`), 1),
		).rejects.toThrow(`not ephemeral`)
		await expect(
			client.publish(fixture.domain.address(`cursors`, `ada`), {
				x: `bad`,
				y: 1,
			}),
		).rejects.toThrow()
		await expect(
			client.publish(fixture.domain.address(`cursors`, `ada`), { x: 1, y: 1 }),
		).rejects.toThrow(`denied`)
		expect(client.state).toMatchObject({
			problem: { code: `unauthorized` },
			status: `rejected`,
		})
		rejectPublish = false
		await expect(
			client.publish(fixture.domain.address(`cursors`, `ada`), { x: 1, y: 1 }),
		).rejects.toThrow(`network down`)
		expect(client.state.status).toBe(`offline`)
		relay.current({
			...updateProposal(fixture.domain),
			actor: ``,
			expiresAt: 100,
		})
		await client.flush()
		expect(client.state).toMatchObject({
			problem: { code: `invalid-payload` },
			status: `rejected`,
		})
		relay.current({
			...updateProposal(fixture.domain, { sequence: 2 }),
			actor: `ada`,
			domain: { ...fixture.domain.identity, instance: `other` },
			expiresAt: 100,
		})
		await client.flush()
		expect(client.state.problem?.reason).toContain(`invalid envelope`)
		relay.current({
			...updateProposal(fixture.domain, { sequence: 3, value: 1 }),
			actor: `ada`,
			address: fixture.domain.address(`durable`),
			expiresAt: 100,
		})
		await client.flush()
		expect(client.state.problem?.reason).toContain(`not ephemeral`)
		client[Symbol.dispose]()
		expect(() =>
			createMosaicDomainPresenceClient({
				domain: fixture.domain,
				maxBytes: 0,
				session: `tab`,
				transport: {
					publish: vi.fn(),
					snapshot: vi.fn(),
					subscribe: vi.fn(),
				},
			}),
		).toThrow(`positive integers`)
		fixture.domain[Symbol.dispose]()
	})

	test(`socket client adapters settle, isolate listeners, time out, and dispose`, async () => {
		vi.useFakeTimers()
		try {
			const fixture = await presenceFixture(`presence-client-socket`)
			const browser = fakeSocket()
			const numericTimer = vi
				.spyOn(globalThis, `setTimeout`)
				.mockImplementation(() => 8 as never)
			const browserTransport = createMosaicDomainPresenceSocketTransport(
				browser.socket,
			)
			try {
				const browserSnapshot = browserTransport.snapshot()
				const browserSnapshotRequest = browser.emitted.at(-1)!
				browser.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshotResult, {
					requestId: browserSnapshotRequest.payload.requestId,
					snapshot: { presence: [], sequence: 0 },
				})
				await expect(browserSnapshot).resolves.toEqual({
					presence: [],
					sequence: 0,
				})
				const browserProposal = updateProposal(fixture.domain)
				const browserPublish = browserTransport.publish(browserProposal)
				const browserPublishRequest = browser.emitted.at(-1)!
				browser.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.result, {
					requestId: browserPublishRequest.payload.requestId,
					result: {
						accepted: {
							...browserProposal,
							actor: `ada`,
							expiresAt: 100,
						},
						status: `accepted`,
					},
				})
				await expect(browserPublish).resolves.toMatchObject({
					status: `accepted`,
				})
			} finally {
				browserTransport[Symbol.dispose]()
				numericTimer.mockRestore()
			}
			const fake = fakeSocket()
			const transport = createMosaicDomainPresenceSocketTransport(fake.socket, {
				requestTimeoutMs: 10,
			})
			const snapshotPromise = transport.snapshot()
			const snapshotRequest = fake.emitted.at(-1)!
			expect(snapshotRequest.event).toBe(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshot)
			fake.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshotResult, {
				requestId: 1,
			})
			fake.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshotResult, {
				requestId: `unknown`,
			})
			fake.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshotResult, {
				requestId: snapshotRequest.payload.requestId,
				snapshot: { presence: [], sequence: 0 },
			})
			await expect(snapshotPromise).resolves.toEqual({
				presence: [],
				sequence: 0,
			})

			const proposal = updateProposal(fixture.domain)
			const publishPromise = transport.publish(proposal)
			const publishRequest = fake.emitted.at(-1)!
			fake.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.result, { requestId: 1 })
			fake.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.result, {
				requestId: `unknown`,
			})
			const accepted: MosaicDomainPresenceEnvelope = {
				...proposal,
				actor: `ada`,
				expiresAt: 100,
			}
			fake.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.result, {
				requestId: publishRequest.payload.requestId,
				result: { accepted, status: `accepted` },
			})
			await expect(publishPromise).resolves.toMatchObject({ status: `accepted` })
			const observed = vi.fn()
			transport.subscribe(() => {
				throw new Error(`observer failed`)
			})
			const stopObserving = transport.subscribe(observed)
			fake.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.accepted, accepted)
			expect(observed).toHaveBeenCalledWith(accepted)
			stopObserving()
			fake.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.accepted, accepted)
			expect(observed).toHaveBeenCalledOnce()

			const timeout = transport.snapshot()
			const timeoutAssertion = expect(timeout).rejects.toThrow(`timed out`)
			await vi.advanceTimersByTimeAsync(11)
			await timeoutAssertion
			const proposalTimeout = transport.publish(proposal)
			const proposalTimeoutAssertion =
				expect(proposalTimeout).rejects.toThrow(`timed out`)
			await vi.advanceTimersByTimeAsync(11)
			await proposalTimeoutAssertion
			const pending = transport.publish(proposal)
			const pendingAssertion = expect(pending).rejects.toThrow(`disconnected`)
			fake.dispatch(`disconnect`)
			await pendingAssertion
			transport[Symbol.dispose]()
			transport[Symbol.dispose]()
			await expect(transport.snapshot()).rejects.toThrow(`disposed`)
			await expect(transport.publish(proposal)).rejects.toThrow(`disposed`)
			expect(() =>
				createMosaicDomainPresenceSocketTransport(fake.socket, {
					requestTimeoutMs: 0,
				}),
			).toThrow(`positive integers`)
			const invalidIds = createMosaicDomainPresenceSocketTransport(fake.socket, {
				idSource: () => ``,
			})
			await expect(invalidIds.publish(proposal)).rejects.toThrow(`unique`)
			await expect(invalidIds.snapshot()).rejects.toThrow(`unique`)
			invalidIds[Symbol.dispose]()
			fixture.domain[Symbol.dispose]()
		} finally {
			vi.useRealTimers()
		}
	})

	test(`socket server adapters reject malformed requests and clean up safely`, async () => {
		const fixture = await presenceFixture(`presence-server-socket`)
		const fake = fakeSocket()
		const proposal = updateProposal(fixture.domain)
		const accepted: MosaicDomainPresenceEnvelope = {
			...proposal,
			actor: `ada`,
			expiresAt: 100,
		}
		let relay: ((presence: MosaicDomainPresenceEnvelope) => void) | undefined
		const disconnect = vi.fn(() => Promise.resolve())
		const publish = vi.fn(() =>
			Promise.resolve({ accepted, status: `accepted` } as const),
		)
		const snapshot = vi.fn(() =>
			Promise.resolve({ presence: [accepted], sequence: 1 }),
		)
		const unsubscribe = vi.fn()
		const connection: MosaicDomainPresenceConnection = {
			disconnect,
			publish,
			snapshot,
			subscribe(listener) {
				relay = listener
				return unsubscribe
			},
		}
		const tracker: MosaicDomainPresenceWorkTracker = {
			track: <Value>(work: PromiseLike<Value>) => Promise.resolve(work),
		}
		const cleanup = bindMosaicDomainPresenceServerSocket(
			connection,
			fake.socket,
			tracker,
		)
		fake.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.proposal, {
			requestId: `missing`,
		})
		fake.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.proposal, 1n)
		expect(publish).not.toHaveBeenCalled()
		fake.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.proposal, {
			proposal,
			requestId: `proposal`,
		})
		await vi.waitFor(() => {
			expect(publish).toHaveBeenCalledWith(proposal)
		})
		expect(fake.emitted).toContainEqual({
			event: MOSAIC_DOMAIN_PRESENCE_EVENTS.result,
			payload: {
				requestId: `proposal`,
				result: { accepted, status: `accepted` },
			},
		})
		fake.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshot, { requestId: `` })
		expect(snapshot).not.toHaveBeenCalled()
		fake.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshot, {
			requestId: `snapshot`,
		})
		await vi.waitFor(() => {
			expect(snapshot).toHaveBeenCalledOnce()
		})
		relay?.(accepted)
		expect(fake.emitted).toContainEqual({
			event: MOSAIC_DOMAIN_PRESENCE_EVENTS.accepted,
			payload: accepted,
		})
		await cleanup()
		await cleanup()
		expect(unsubscribe).toHaveBeenCalledOnce()
		expect(disconnect).toHaveBeenCalledOnce()
		const emittedAfterCleanup = fake.emitted.length
		relay?.(accepted)
		expect(fake.emitted).toHaveLength(emittedAfterCleanup)

		const rejecting = fakeSocket()
		const rejectionConnection: MosaicDomainPresenceConnection = {
			...connection,
			disconnect: vi.fn(() => Promise.reject(new Error(`disconnect failed`))),
			subscribe: () => () => {
				throw new Error(`unsubscribe failed`)
			},
		}
		const rejectionCleanup = bindMosaicDomainPresenceServerSocket(
			rejectionConnection,
			rejecting.socket,
		)
		rejecting.dispatch(`disconnect`)
		await Promise.resolve()
		expect(rejectionConnection.disconnect).toHaveBeenCalledOnce()
		await rejectionCleanup()

		const explicit = fakeSocket()
		const explicitUnsubscribe = vi.fn(() => {
			throw new Error(`unsubscribe failed`)
		})
		const explicitDisconnect = vi.fn(() =>
			Promise.reject(new Error(`disconnect failed`)),
		)
		const explicitCleanup = bindMosaicDomainPresenceServerSocket(
			{
				...connection,
				disconnect: explicitDisconnect,
				subscribe: () => explicitUnsubscribe,
			},
			explicit.socket,
		)
		await expect(explicitCleanup()).rejects.toThrow(`cleanup failed`)
		expect(explicitUnsubscribe).toHaveBeenCalledOnce()
		expect(explicitDisconnect).toHaveBeenCalledOnce()

		const malformed = fakeSocket()
		const tracked: Promise<unknown>[] = []
		const failingConnection: MosaicDomainPresenceConnection = {
			disconnect: () => Promise.resolve(),
			publish: () => Promise.reject(new Error(`publish failed`)),
			snapshot: () => Promise.reject(new Error(`snapshot failed`)),
			subscribe: () => () => undefined,
		}
		bindMosaicDomainPresenceServerSocket(failingConnection, malformed.socket, {
			track: <Value>(work: PromiseLike<Value>) => {
				const trackedWork = Promise.resolve(work)
				tracked.push(trackedWork)
				return trackedWork
			},
		})
		malformed.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.proposal, {
			proposal: () => undefined,
			requestId: `uncloneable-proposal`,
		})
		malformed.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshot, {
			requestId: `uncloneable-snapshot`,
			value: () => undefined,
		})
		malformed.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.proposal, {
			proposal,
			requestId: `rejected-proposal`,
		})
		malformed.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshot, {
			requestId: `rejected-snapshot`,
		})
		await Promise.allSettled(tracked)
		await Promise.resolve()
		expect(malformed.emitted).toEqual([])

		const late = fakeSocket()
		let acceptLate: (value: {
			accepted: typeof accepted
			status: `accepted`
		}) => void
		let snapshotLate: (value: {
			presence: MosaicDomainPresenceEnvelope[]
			sequence: number
		}) => void
		const lateConnection: MosaicDomainPresenceConnection = {
			disconnect: () => Promise.resolve(),
			publish: () =>
				new Promise((resolve) => {
					acceptLate = resolve
				}),
			snapshot: () =>
				new Promise((resolve) => {
					snapshotLate = resolve
				}),
			subscribe: () => () => undefined,
		}
		const stopLate = bindMosaicDomainPresenceServerSocket(
			lateConnection,
			late.socket,
		)
		late.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.proposal, {
			proposal,
			requestId: `late-proposal`,
		})
		late.dispatch(MOSAIC_DOMAIN_PRESENCE_EVENTS.snapshot, {
			requestId: `late-snapshot`,
		})
		await stopLate()
		acceptLate!({ accepted, status: `accepted` })
		snapshotLate!({ presence: [accepted], sequence: 1 })
		await Promise.resolve()
		expect(late.emitted).toEqual([])
		fixture.domain[Symbol.dispose]()
	})
})
