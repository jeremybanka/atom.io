import { Silo } from "atom.io"
import {
	mosaicDomain,
	type MosaicDomainBatchProposal,
	mosaicDomainMemberModelIdentity,
	type MosaicDomainResidencyRequest,
	type MosaicDomainResidencyTransport,
	type MosaicDomainValueModel,
} from "atom.io/realtime"
import {
	createMosaicDomainResidencyClient,
	type MosaicDomainResidencyClient,
} from "atom.io/realtime-client"
import {
	createMosaicDomainBatchServer,
	createMosaicDomainResidencyServer,
} from "atom.io/realtime-server"
import { headless } from "atom.io/realtime-testing/headless"
import { z } from "zod"

const valueModel = {
	identity: { key: `resident-value`, version: 1 },
	kind: `value`,
	operationSchema: z.object({ type: z.literal(`set`), value: z.number() }),
	reduce(_value, operation) {
		return operation.value
	},
} satisfies MosaicDomainValueModel<number, { type: `set`; value: number }>

async function residencyFixture(
	name: string,
	silo = new Silo({ isProduction: false, lifespan: `ephemeral`, name }),
) {
	const valueAtoms = silo.atomFamily<number, string>({
		default: 0,
		key: `value`,
	})
	const definition = mosaicDomain({
		configSchema: z.object({}),
		key: `mos12-residency`,
		members: {
			values: {
				keySchema: z.string().transform((key) => key.trim()),
				model: valueModel,
				role: `durable`,
				schema: z.number(),
				token: valueAtoms,
			},
		},
		version: 1,
	})
	const domain = await definition.activate({
		config: {},
		instance: `document`,
		store: silo.store,
	})
	return { domain, silo, valueAtoms }
}

async function tokenFor(
	state: Awaited<ReturnType<typeof residencyFixture>>,
	key: string,
) {
	const parsed = await state.domain.parseAddress(
		state.domain.address(`values`, key),
	)
	return (await state.domain.acquire(parsed)).token
}

const settle = async (): Promise<void> => {
	for (let turn = 0; turn < 8; turn++) await Promise.resolve()
}

const waitFor = async (condition: () => boolean): Promise<void> => {
	for (let turn = 0; turn < 100; turn++) {
		if (condition()) return
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
	}
	throw new Error(`The residency condition did not settle.`)
}

describe(`Mosaic Domain partial residency`, () => {
	test(`rejects unauthorized or over-capacity acquisition before allocation`, async () => {
		const serverState = await residencyFixture(`residency-server-denied`)
		const clientState = await residencyFixture(`residency-client-denied`)
		const batchServer = createMosaicDomainBatchServer({
			domain: serverState.domain,
		})
		const residencyServer = createMosaicDomainResidencyServer({
			authorize: () => false,
			batches: batchServer,
			domain: serverState.domain,
		})
		const client = createMosaicDomainResidencyClient({
			actor: `mallory`,
			domain: clientState.domain,
			maxResidentMembers: 1,
			session: `session-m`,
			transport: residencyServer.connect({
				actor: `mallory`,
				session: `session-m`,
			}),
		})
		const clientBefore = clientState.silo.store.atoms.size
		const serverBefore = serverState.silo.store.atoms.size
		await expect(
			client.acquire(clientState.domain.address(`values`, `denied`)),
		).rejects.toThrow(`unauthorized`)
		expect(clientState.silo.store.atoms.size).toBe(clientBefore)
		expect(serverState.silo.store.atoms.size).toBe(serverBefore)
		await client.dispose()

		const allowedState = await residencyFixture(`residency-client-capacity`)
		const allowed = createMosaicDomainResidencyClient({
			actor: `alice`,
			domain: allowedState.domain,
			estimateBytes: () => {
				throw new Error(`instrumentation failed`)
			},
			maxResidentMembers: 1,
			session: `session-a`,
			transport: createMosaicDomainResidencyServer({
				batches: batchServer,
				domain: serverState.domain,
			}).connect({ actor: `alice`, session: `session-a` }),
		})
		const first = await allowed.acquire(
			allowedState.domain.address(`values`, `first`),
		)
		expect(allowed.state.estimatedResidentBytes).toBe(1)
		first.release()
		await settle()
		await expect(
			allowed.acquire(allowedState.domain.address(`values`, `second`)),
		).rejects.toThrow(`count exceeds 1`)
		expect(allowed.state.residentMemberCount).toBe(1)
		await allowed.dispose()
	})

	test(`authorizes normalized keys before lookup and reference-counts leases`, async () => {
		const serverState = await residencyFixture(`residency-server-auth`)
		const clientState = await residencyFixture(`residency-client-auth`)
		const batchServer = createMosaicDomainBatchServer({
			domain: serverState.domain,
		})
		const order: string[] = []
		const residencyServer = createMosaicDomainResidencyServer({
			authorize: (context) => {
				order.push(
					context.action === `read-member`
						? `authorize:${String(context.address.key)}`
						: `authorize-range`,
				)
				return true
			},
			batches: batchServer,
			domain: serverState.domain,
			range: {
				resolve: ({ domain, range }) => {
					order.push(`resolve:${range.prefix}`)
					return [domain.address(`values`, `${range.prefix}1`)]
				},
				schema: z.object({
					prefix: z.string().transform((value) => value.trim()),
				}),
			},
		})
		const client = createMosaicDomainResidencyClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: residencyServer.connect({
				actor: `alice`,
				session: `session-a`,
			}),
		})

		const first = await client.acquire(
			clientState.domain.address(`values`, ` shared `),
		)
		const second = await client.acquire(
			clientState.domain.address(`values`, `shared`),
		)
		expect(first.token.key).toBe(second.token.key)
		expect(client.state).toMatchObject({
			requestedMemberCount: 1,
			residentMemberCount: 1,
		})
		first.release()
		await settle()
		await expect(
			client.evict(clientState.domain.address(`values`, `shared`)),
		).resolves.toBe(false)
		second.release()
		await settle()
		await expect(
			client.evict(clientState.domain.address(`values`, `shared`)),
		).resolves.toBe(true)
		expect(client.state.residentMemberCount).toBe(0)
		const revoked = await client.acquire(
			clientState.domain.address(`values`, `revoked`),
		)
		await expect(client.forceEvict(revoked.address)).resolves.toBe(true)
		expect(revoked.active).toBe(false)
		expect(client.state.residentMemberCount).toBe(0)

		const range = await client.subscribe({
			kind: `range`,
			limit: 2,
			member: `values`,
			range: { prefix: ` range ` },
		})
		expect(order.slice(-3)).toEqual([
			`authorize-range`,
			`resolve:range`,
			`authorize:range1`,
		])
		await range.release()
		await client.dispose()
	})

	test(`keeps an offline owned outbox through eviction and rehydrates it later`, async () => {
		const serverState = await residencyFixture(`residency-server-outbox`)
		const clientState = await residencyFixture(`residency-client-outbox`)
		const batchServer = createMosaicDomainBatchServer({
			domain: serverState.domain,
		})
		const residencyServer = createMosaicDomainResidencyServer({
			batches: batchServer,
			domain: serverState.domain,
		})
		const connected = residencyServer.connect({
			actor: `alice`,
			session: `session-a`,
		})
		let offline = true
		const transport: MosaicDomainResidencyTransport<
			typeof clientState.domain.identity
		> = {
			dispose: () => connected.dispose?.(),
			hydrate: (requests) => connected.hydrate(requests),
			propose(batch) {
				return offline
					? Promise.reject(new Error(`offline`))
					: connected.propose(batch)
			},
			subscribe: (requests, listener) => connected.subscribe(requests, listener),
		}
		const cleaned: string[] = []
		const client = createMosaicDomainResidencyClient({
			actor: `alice`,
			cleanup: (address) => {
				cleaned.push(String(address.key))
			},
			domain: clientState.domain,
			session: `session-a`,
			transport,
		})
		const address = clientState.domain.address(`values`, `offline-member`)
		const lease = await client.acquire(address)
		await client.submit({
			address,
			operation: { type: `set`, value: 41 },
		})
		expect(client.state.pendingBatchIds).toHaveLength(1)
		lease.release()
		await settle()
		await expect(client.evict(address)).resolves.toBe(true)
		expect(client.state).toMatchObject({
			pendingBatchIds: [expect.any(String)],
			residentMemberCount: 0,
		})

		offline = false
		await client.reconnect()
		expect(client.state.pendingBatchIds).toEqual([])
		expect(client.state.residentMemberCount).toBe(0)
		const reacquired = await client.acquire(address)
		expect(clientState.silo.getState(reacquired.token)).toBe(41)
		await client.dispose()
		expect(clientState.silo.store.atoms.has(reacquired.token.key)).toBe(false)
		expect(cleaned).toEqual([`offline-member`, `offline-member`])
		expect(
			serverState.silo.getState(serverState.valueAtoms, `offline-member`),
		).toBe(41)
	})

	test(`refreshes an injected range from bounded per-request invalidation`, async () => {
		const serverState = await residencyFixture(`residency-server-range`)
		const clientState = await residencyFixture(`residency-client-range`)
		const writerState = await residencyFixture(`residency-writer-range`)
		const batchServer = createMosaicDomainBatchServer({
			domain: serverState.domain,
		})
		let rangeKeys = [`first`]
		const residencyServer = createMosaicDomainResidencyServer({
			batches: batchServer,
			domain: serverState.domain,
			range: {
				resolve: ({ domain, limit }) =>
					rangeKeys.slice(0, limit).map((key) => domain.address(`values`, key)),
				schema: z.object({ all: z.literal(true) }),
			},
		})
		const client = createMosaicDomainResidencyClient({
			actor: `reader`,
			domain: clientState.domain,
			session: `session-reader`,
			transport: residencyServer.connect({
				actor: `reader`,
				session: `session-reader`,
			}),
		})
		const writer = createMosaicDomainResidencyClient({
			actor: `writer`,
			domain: writerState.domain,
			session: `session-writer`,
			transport: residencyServer.connect({
				actor: `writer`,
				session: `session-writer`,
			}),
		})
		const invalidations: number[] = []
		const invalidationValues: number[] = []
		const secondToken = await tokenFor(clientState, `second`)
		const range = await client.subscribe(
			{ kind: `range`, limit: 1, member: `values`, range: { all: true } },
			(accepted) => {
				invalidations.push(accepted.invalidations[0].matchedOperationCount)
				invalidationValues.push(clientState.silo.getState(secondToken))
			},
		)
		const writerSecond = await writer.acquire(
			writerState.domain.address(`values`, `second`),
		)
		rangeKeys = [`second`]
		await writer.submit({
			address: writerSecond.address,
			operation: { type: `set`, value: 22 },
		})
		await waitFor(
			() =>
				client.state.connectivity === `live` &&
				client.state.residentMemberCount === 2,
		)

		expect(invalidations).toEqual([1])
		expect(invalidationValues).toEqual([22])
		expect(client.state).toMatchObject({
			requestedMemberCount: 1,
			residentMemberCount: 2,
		})
		expect(
			clientState.silo.getState(await tokenFor(clientState, `second`)),
		).toBe(22)
		await range.release()
		await Promise.all([client.dispose(), writer.dispose()])
	})

	test(`rehydrates a requested cut after a filtered revision gap`, async () => {
		const serverState = await residencyFixture(`residency-server-gap`)
		const readerState = await residencyFixture(`residency-reader-gap`)
		const writerState = await residencyFixture(`residency-writer-gap`)
		const batchServer = createMosaicDomainBatchServer({
			domain: serverState.domain,
		})
		const residencyServer = createMosaicDomainResidencyServer({
			batches: batchServer,
			domain: serverState.domain,
		})
		const readerConnection = residencyServer.connect({
			actor: `reader`,
			session: `session-reader`,
		})
		let dropped = false
		const reader = createMosaicDomainResidencyClient({
			actor: `reader`,
			domain: readerState.domain,
			session: `session-reader`,
			transport: {
				dispose: () => readerConnection.dispose?.(),
				hydrate: (requests) => readerConnection.hydrate(requests),
				propose: (batch) => readerConnection.propose(batch),
				subscribe: (requests, listener) =>
					readerConnection.subscribe(requests, (accepted) => {
						if (!dropped) {
							dropped = true
							return
						}
						listener(accepted)
					}),
			},
		})
		const writer = createMosaicDomainResidencyClient({
			actor: `writer`,
			domain: writerState.domain,
			session: `session-writer`,
			transport: residencyServer.connect({
				actor: `writer`,
				session: `session-writer`,
			}),
		})
		const address = readerState.domain.address(`values`, `gap`)
		const readerLease = await reader.acquire(address)
		const writerLease = await writer.acquire(
			writerState.domain.address(`values`, `gap`),
		)
		await writer.submit({
			address: writerLease.address,
			operation: { type: `set`, value: 1 },
		})
		await writer.submit({
			address: writerLease.address,
			operation: { type: `set`, value: 2 },
		})
		await waitFor(() => readerState.silo.getState(readerLease.token) === 2)

		expect(dropped).toBe(true)
		expect(reader.state).toMatchObject({
			connectivity: `live`,
			headRevision: 2,
			residentMemberCount: 1,
		})
		await Promise.all([reader.dispose(), writer.dispose()])
	})

	test(`settles every resident part atomically and never allocates unloaded parts`, async () => {
		const serverState = await residencyFixture(`residency-server-atomic`)
		const aliceState = await residencyFixture(`residency-alice-atomic`)
		const bobState = await residencyFixture(`residency-bob-atomic`)
		const writerState = await residencyFixture(`residency-writer-atomic`)
		const batchServer = createMosaicDomainBatchServer({
			domain: serverState.domain,
		})
		const residencyServer = createMosaicDomainResidencyServer({
			batches: batchServer,
			domain: serverState.domain,
		})
		const makeClient = (
			actor: string,
			state: Awaited<ReturnType<typeof residencyFixture>>,
		) =>
			createMosaicDomainResidencyClient({
				actor,
				domain: state.domain,
				session: `session-${actor}`,
				transport: residencyServer.connect({
					actor,
					session: `session-${actor}`,
				}),
			})
		const alice = makeClient(`alice`, aliceState)
		const bob = makeClient(`bob`, bobState)
		const writer = makeClient(`writer`, writerState)
		const aliceA = await alice.acquire(aliceState.domain.address(`values`, `a`))
		const aliceB = await alice.acquire(aliceState.domain.address(`values`, `b`))
		const bobC = await bob.acquire(bobState.domain.address(`values`, `c`))
		const writerA = await writer.acquire(
			writerState.domain.address(`values`, `a`),
		)
		const writerB = await writer.acquire(
			writerState.domain.address(`values`, `b`),
		)
		const writerC = await writer.acquire(
			writerState.domain.address(`values`, `c`),
		)
		const observations: [number, number][] = []
		const observedA = await tokenFor(aliceState, `a`)
		aliceState.silo.subscribe(observedA, () => {
			observations.push([
				aliceState.silo.getState(aliceA.token),
				aliceState.silo.getState(aliceB.token),
			])
		})
		await writer.submit([
			{
				address: writerA.address,
				operation: { type: `set`, value: 1 },
			},
			{
				address: writerB.address,
				operation: { type: `set`, value: 2 },
			},
			{
				address: writerC.address,
				operation: { type: `set`, value: 3 },
			},
		])
		await settle()

		expect(observations).toEqual([[1, 2]])
		expect(aliceState.silo.getState(aliceA.token)).toBe(1)
		expect(aliceState.silo.getState(aliceB.token)).toBe(2)
		expect(bobState.silo.getState(bobC.token)).toBe(3)
		expect(
			aliceState.silo.store.atoms.has((await tokenFor(aliceState, `c`)).key),
		).toBe(false)
		expect(
			bobState.silo.store.atoms.has((await tokenFor(bobState, `a`)).key),
		).toBe(false)
		expect(
			bobState.silo.store.atoms.has((await tokenFor(bobState, `b`)).key),
		).toBe(false)
		expect(alice.state.residentMemberCount).toBe(2)
		expect(bob.state.residentMemberCount).toBe(1)
		await Promise.all([alice.dispose(), bob.dispose(), writer.dispose()])
	})

	test(`uses realtime-testing clients as arbitrary residency transports`, async () => {
		const hydrateEvent = `mos12:hydrate`
		const proposeEvent = `mos12:propose`
		const subscribeEvent = `mos12:subscribe`
		const unsubscribeEvent = `mos12:unsubscribe`
		const acceptedEvent = `mos12:accepted`
		let serverStatePromise: ReturnType<typeof residencyFixture> | undefined
		let residencyServerPromise:
			| Promise<ReturnType<typeof createMosaicDomainResidencyServer>>
			| undefined
		const scenario = headless({
			scenarioId: `mos12-residency`,
			server: (tools) => {
				serverStatePromise ??= residencyFixture(`server-harness`, tools.silo)
				residencyServerPromise ??= serverStatePromise.then((state) => {
					const batches = createMosaicDomainBatchServer({ domain: state.domain })
					return createMosaicDomainResidencyServer({
						batches,
						domain: state.domain,
					})
				})
				const connection = residencyServerPromise.then((server) =>
					server.connect({
						actor: tools.userKey,
						session: tools.sessionId,
					}),
				)
				const subscriptions = new Map<string, () => void>()
				tools.socket.on(
					hydrateEvent,
					(
						requests: MosaicDomainResidencyRequest[],
						respond: (value: unknown) => void,
					) => {
						void tools.work
							.track(
								connection.then((connected) => connected.hydrate(requests)),
								`hydrate resident members`,
							)
							.then(respond)
					},
				)
				tools.socket.on(
					proposeEvent,
					(
						batch: MosaicDomainBatchProposal,
						respond: (value: unknown) => void,
					) => {
						void tools.work
							.track(
								connection.then((connected) => connected.propose(batch)),
								`propose resident batch`,
							)
							.then(respond)
					},
				)
				tools.socket.on(
					subscribeEvent,
					(
						id: string,
						requests: MosaicDomainResidencyRequest[],
						respond: () => void,
					) => {
						void tools.work
							.track(
								connection.then(async (connected) => {
									const stop = await connected.subscribe(
										requests,
										(accepted) => {
											tools.socket.emit(acceptedEvent, id, accepted)
										},
									)
									subscriptions.set(id, stop)
								}),
								`subscribe resident members`,
							)
							.then(respond)
					},
				)
				tools.socket.on(unsubscribeEvent, (id: string) => {
					subscriptions.get(id)?.()
					subscriptions.delete(id)
				})
				return () => {
					for (const stop of subscriptions.values()) stop()
				}
			},
		})
		const aliceHarness = scenario.createClient({ name: `alice` })
		const bobHarness = scenario.createClient({ name: `bob` })
		const socketTransport = (
			harness: typeof aliceHarness,
		): MosaicDomainResidencyTransport => {
			let subscription = 0
			return {
				hydrate(requests) {
					return new Promise((resolve) => {
						harness.socket.emit(hydrateEvent, requests, resolve)
					})
				},
				propose(batch) {
					return new Promise((resolve) => {
						harness.socket.emit(proposeEvent, batch, resolve)
					})
				},
				subscribe(requests, listener) {
					const id = `${harness.sessionId}:${subscription++}`
					const receive = (incomingId: string, accepted: unknown): void => {
						if (incomingId === id) listener(accepted as never)
					}
					harness.socket.on(acceptedEvent, receive)
					return new Promise((resolve) => {
						harness.socket.emit(subscribeEvent, id, requests, () => {
							resolve(() => {
								harness.socket.off(acceptedEvent, receive)
								harness.socket.emit(unsubscribeEvent, id)
							})
						})
					})
				},
			}
		}
		let alice: MosaicDomainResidencyClient | undefined
		let bob: MosaicDomainResidencyClient | undefined
		try {
			await scenario.waitForIdle()
			const aliceState = await residencyFixture(
				`alice-harness`,
				aliceHarness.silo,
			)
			const bobState = await residencyFixture(`bob-harness`, bobHarness.silo)
			alice = createMosaicDomainResidencyClient({
				actor: aliceHarness.userKey,
				domain: aliceState.domain,
				session: aliceHarness.sessionId,
				transport: socketTransport(aliceHarness),
			})
			bob = createMosaicDomainResidencyClient({
				actor: bobHarness.userKey,
				domain: bobState.domain,
				session: bobHarness.sessionId,
				transport: socketTransport(bobHarness),
			})
			const aliceLease = await aliceHarness.work.track(
				alice.acquire(aliceState.domain.address(`values`, `alice-only`)),
				`acquire Alice member`,
			)
			const bobLease = await bobHarness.work.track(
				bob.acquire(bobState.domain.address(`values`, `bob-only`)),
				`acquire Bob member`,
			)
			await aliceHarness.work.track(
				alice.submit({
					address: aliceLease.address,
					operation: { type: `set`, value: 12 },
				}),
				`edit Alice member`,
			)
			await bobHarness.work.track(
				bob.submit({
					address: bobLease.address,
					operation: { type: `set`, value: 24 },
				}),
				`edit Bob member`,
			)
			await scenario.waitForIdle()
			expect(aliceState.silo.getState(aliceLease.token)).toBe(12)
			expect(bobState.silo.getState(bobLease.token)).toBe(24)
			expect(
				aliceState.silo.store.atoms.has(
					(await tokenFor(aliceState, `bob-only`)).key,
				),
			).toBe(false)
			expect(
				bobState.silo.store.atoms.has(
					(await tokenFor(bobState, `alice-only`)).key,
				),
			).toBe(false)
		} finally {
			await Promise.all([alice?.dispose(), bob?.dispose()])
			await scenario.teardown()
		}
	})
})
