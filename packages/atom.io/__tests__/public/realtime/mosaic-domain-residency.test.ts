import { Silo } from "atom.io"
import {
	assertMosaicDomainResidencyAcceptedSlice,
	MAX_MOSAIC_DOMAIN_RESIDENCY_INVALIDATIONS,
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
	type MosaicDomainBatchServer,
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
	const fixedAtom = silo.atom<number>({ default: 0, key: `fixed` })
	const cursorAtoms = silo.atomFamily<number, string>({
		default: 0,
		key: `cursor`,
	})
	const valueAtoms = silo.atomFamily<number, string>({
		default: 0,
		key: `value`,
	})
	const definition = mosaicDomain({
		configSchema: z.object({}),
		key: `mos12-residency`,
		members: {
			cursor: {
				keySchema: z.string(),
				role: `ephemeral`,
				schema: z.number(),
				token: cursorAtoms,
			},
			fixed: { role: `durable`, schema: z.number(), token: fixedAtom },
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
	return { cursorAtoms, domain, fixedAtom, silo, valueAtoms }
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
	test(`bounds malformed server scopes before allocation or resolver work`, async () => {
		const state = await residencyFixture(`residency-server-bounds`)
		const batches = createMosaicDomainBatchServer({ domain: state.domain })
		for (const options of [
			{ maxRequests: 0 },
			{ maxResidentMembers: 0 },
			{ maxRangeBytes: 0 },
			{ maxRangeDepth: 0 },
		]) {
			expect(() =>
				createMosaicDomainResidencyServer({
					...options,
					batches,
					domain: state.domain,
				}),
			).toThrow(`positive safe integer`)
		}
		expect(() =>
			createMosaicDomainResidencyServer({
				batches,
				domain: state.domain,
				maxRequests: MAX_MOSAIC_DOMAIN_RESIDENCY_INVALIDATIONS + 1,
			}),
		).toThrow(`maxRequests cannot exceed`)

		let resolution: unknown = []
		let resolverCalls = 0
		const server = createMosaicDomainResidencyServer({
			authorize(context) {
				if (
					context.action === `read-member` &&
					context.address.key === `authorization-error`
				) {
					throw new Error(`policy unavailable`)
				}
				return true
			},
			batches,
			domain: state.domain,
			maxRangeBytes: 48,
			maxRangeDepth: 2,
			maxRequests: 2,
			maxResidentMembers: 1,
			range: {
				resolve: () => {
					resolverCalls++
					return resolution as readonly ReturnType<
						typeof state.domain.address<`values`>
					>[]
				},
				schema: z.any(),
			},
		})
		const connection = server.connect({ actor: `reader`, session: `session-r` })
		const address = state.domain.address(`values`, `first`)
		const request = (selection: unknown, id = `request`) =>
			[{ id, selection }] as never
		const atomsBefore = state.silo.store.atoms.size

		await expect(connection.hydrate({} as never)).rejects.toThrow(
			`requests exceed`,
		)
		await expect(
			connection.hydrate([
				{ id: `one`, selection: { addresses: [address], kind: `members` } },
				{ id: `two`, selection: { addresses: [address], kind: `members` } },
				{ id: `three`, selection: { addresses: [address], kind: `members` } },
			] as never),
		).rejects.toThrow(`requests exceed 2`)
		await expect(
			connection.hydrate([
				{ id: `same`, selection: { addresses: [], kind: `members` } },
				{ id: `same`, selection: { addresses: [], kind: `members` } },
			] as never),
		).rejects.toThrow(`request ID`)
		await expect(
			connection.hydrate(request({ addresses: {}, kind: `members` })),
		).rejects.toThrow(`member selection`)
		await expect(
			connection.hydrate(
				request({ addresses: [address, address], kind: `members` }),
			),
		).rejects.toThrow(`member selection exceeds 1`)
		await expect(
			connection.hydrate(request({ kind: `unknown` })),
		).rejects.toThrow(`selection is invalid`)
		await expect(
			connection.hydrate(
				request({
					addresses: [state.domain.address(`cursor`, `alice`)],
					kind: `members`,
				}),
			),
		).rejects.toThrow(`durable members only`)
		await expect(
			connection.hydrate(
				request({
					addresses: [state.domain.address(`values`, `authorization-error`)],
					kind: `members`,
				}),
			),
		).rejects.toThrow(`unauthorized`)

		const range = (rangeValue: unknown, limit = 1, member = `values`) => ({
			kind: `range`,
			limit,
			member,
			range: rangeValue,
		})
		await expect(connection.hydrate(request(range({}, 0)))).rejects.toThrow(
			`limit must be positive`,
		)
		await expect(connection.hydrate(request(range({}, 2)))).rejects.toThrow(
			`limit exceeds 1`,
		)
		await expect(
			connection.hydrate(request(range({ query: `x`.repeat(100) }))),
		).rejects.toThrow(`range bytes exceed 48`)
		await expect(
			connection.hydrate(request(range({ a: { b: { c: true } } }))),
		).rejects.toThrow(`range depth exceeds 2`)
		await expect(connection.hydrate(request(range(new Date())))).rejects.toThrow(
			`JSON-serializable`,
		)
		const cyclic: { self?: unknown } = {}
		cyclic.self = cyclic
		await expect(connection.hydrate(request(range(cyclic)))).rejects.toThrow(
			`JSON-serializable`,
		)
		await expect(
			connection.hydrate(request(range({}, 1, `fixed`))),
		).rejects.toThrow(`durable family member`)
		expect(resolverCalls).toBe(0)

		resolution = {}
		await expect(connection.hydrate(request(range({})))).rejects.toThrow(
			`range resolution is invalid`,
		)
		resolution = [address, address]
		await expect(connection.hydrate(request(range({})))).rejects.toThrow(
			`resolver exceeded its limit`,
		)
		resolution = [state.domain.address(`fixed`)]
		await expect(connection.hydrate(request(range({})))).rejects.toThrow(
			`resolved another member`,
		)
		resolution = []
		await expect(
			connection.hydrate(request(range([true, `small`, null, 1]))),
		).resolves.toMatchObject({ members: [] })
		resolution = [address]
		await expect(
			connection.hydrate([
				{ id: `one`, selection: { addresses: [address], kind: `members` } },
				{
					id: `two`,
					selection: {
						addresses: [state.domain.address(`values`, `second`)],
						kind: `members`,
					},
				},
			] as never),
		).rejects.toThrow(`resolved residency exceeds 1`)
		expect(state.silo.store.atoms.size).toBe(atomsBefore)

		const stop = await connection.subscribe([], () => {})
		stop()
		stop()
		connection.dispose?.()
		connection.dispose?.()
		await expect(
			connection.hydrate(request({ addresses: [], kind: `members` })),
		).rejects.toThrow(`connection is disposed`)
		const remaining = server.connect({ actor: `reader`, session: `remaining` })
		await remaining.subscribe([], () => {})
		server[Symbol.dispose]()
		server[Symbol.dispose]()
		expect(() => server.connect({ actor: `reader`, session: `later` })).toThrow(
			`server is disposed`,
		)
	})

	test(`fails a checkpoint whose authoritative revision never stabilizes`, async () => {
		const state = await residencyFixture(`residency-server-unstable-checkpoint`)
		let revision = 0
		const batches = {
			connect: () => ({
				propose: () => Promise.reject(new Error(`not used`)),
				recover: () => Promise.resolve({ headRevision: revision++, tail: [] }),
				subscribe: () => () => {},
			}),
			dispose: () => {},
			get revision() {
				return revision
			},
		} satisfies MosaicDomainBatchServer
		const server = createMosaicDomainResidencyServer({
			batches,
			domain: state.domain,
		})
		const connection = server.connect({ actor: `reader`, session: `unstable` })

		await expect(connection.hydrate([])).rejects.toThrow(
			`could not stabilize a checkpoint`,
		)
	})

	test(`rejects ranges when no range resolver is configured`, async () => {
		const state = await residencyFixture(`residency-server-no-range`)
		const server = createMosaicDomainResidencyServer({
			batches: createMosaicDomainBatchServer({ domain: state.domain }),
			domain: state.domain,
		})

		await expect(
			server.connect({ actor: `reader`, session: `no-range` }).hydrate([
				{
					id: `range`,
					selection: {
						kind: `range`,
						limit: 1,
						member: `values`,
						range: {},
					},
				},
			]),
		).rejects.toThrow(`does not provide range resolution`)
	})

	test(`rejects invalid range schemas before lookup`, async () => {
		const state = await residencyFixture(`residency-server-range-schema`)
		const batches = createMosaicDomainBatchServer({ domain: state.domain })
		let resolverCalls = 0
		const invalid = createMosaicDomainResidencyServer({
			batches,
			domain: state.domain,
			range: {
				resolve: () => {
					resolverCalls++
					return []
				},
				schema: z.object({ ok: z.literal(true) }),
			},
		}).connect({ actor: `reader`, session: `invalid-schema` })
		await expect(
			invalid.hydrate([
				{
					id: `range`,
					selection: {
						kind: `range`,
						limit: 1,
						member: `values`,
						range: { ok: false },
					},
				},
			] as never),
		).rejects.toThrow(`range failed validation`)

		const drifting = createMosaicDomainResidencyServer({
			batches,
			domain: state.domain,
			range: {
				resolve: () => {
					resolverCalls++
					return []
				},
				schema: z
					.object({ step: z.number() })
					.transform(({ step }) => ({ step: step + 1 })),
			},
		}).connect({ actor: `reader`, session: `drifting-schema` })
		await expect(
			drifting.hydrate([
				{
					id: `range`,
					selection: {
						kind: `range`,
						limit: 1,
						member: `values`,
						range: { step: 0 },
					},
				},
			]),
		).rejects.toThrow(`normalize idempotently`)
		expect(resolverCalls).toBe(0)
	})

	test(`validates every bounded accepted-slice field`, async () => {
		const state = await residencyFixture(`residency-slice-validation`)
		const address = state.domain.address(`values`, `member`)
		const batch = {
			affectedMembers: [address],
			actor: `writer`,
			dependencies: [],
			domain: state.domain.identity,
			group: null,
			id: `batch`,
			operations: [
				{
					address,
					id: `operation`,
					model: mosaicDomainMemberModelIdentity(valueModel),
					operation: { type: `set`, value: 1 },
				},
			],
			protocolVersion: 1,
			sequence: 1,
			session: `session-writer`,
		}
		const accepted = {
			batch: { batch, revision: 1 },
			invalidations: [
				{
					matchedOperationCount: 1,
					refresh: false,
					requestId: `request`,
					revisionToken: `revision:1`,
				},
			],
			metadata: {
				actor: `writer`,
				affectedMemberCount: 1,
				batchId: `batch`,
				dependencyCount: 0,
				group: null,
				operationCount: 1,
				revision: 1,
				revisionToken: `revision:1`,
				session: `session-writer`,
			},
		}
		expect(() => {
			assertMosaicDomainResidencyAcceptedSlice(accepted)
		}).not.toThrow()
		expect(() => {
			assertMosaicDomainResidencyAcceptedSlice({
				...accepted,
				batch: undefined,
			})
		}).not.toThrow()
		const invalid = (mutate: (value: any) => void): void => {
			const value = structuredClone(accepted)
			mutate(value)
			expect(() => {
				assertMosaicDomainResidencyAcceptedSlice(value)
			}).toThrow()
		}
		expect(() => {
			assertMosaicDomainResidencyAcceptedSlice(null)
		}).toThrow(`acceptance is invalid`)
		invalid((value) => (value.metadata.actor = ``))
		invalid((value) => (value.metadata.group = ``))
		invalid((value) => (value.metadata.operationCount = -1))
		invalid((value) => (value.metadata.revision = 0))
		invalid((value) => (value.invalidations = {}))
		expect(() => {
			assertMosaicDomainResidencyAcceptedSlice(accepted, 0)
		}).toThrow(`invalidations are invalid`)
		invalid((value) => value.invalidations.push(value.invalidations[0]))
		invalid((value) => (value.invalidations[0].revisionToken = `wrong`))
		invalid((value) => (value.batch = null))
		invalid((value) => (value.batch.revision = 2))
		invalid((value) => (value.batch.batch.actor = `other`))
	})

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

	test(`covers the headless lifecycle without conflating hydration and ownership`, async () => {
		const serverState = await residencyFixture(`residency-server-lifecycle`)
		const clientState = await residencyFixture(`residency-client-lifecycle`)
		const batches = createMosaicDomainBatchServer({ domain: serverState.domain })
		const server = createMosaicDomainResidencyServer({
			batches,
			domain: serverState.domain,
		})
		const transport = server.connect({ actor: `alice`, session: `session-a` })
		const client = createMosaicDomainResidencyClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport,
		})
		expect(() =>
			createMosaicDomainResidencyClient({
				actor: `alice`,
				domain: clientState.domain,
				session: `session-a`,
				transport,
			}),
		).toThrow(`already owns this Store session`)
		for (const options of [
			{ maxBufferedAcceptances: 0 },
			{ maxResidentBytes: 0 },
			{ maxResidentMembers: 0 },
		]) {
			expect(() =>
				createMosaicDomainResidencyClient({
					actor: `invalid-${Object.keys(options)[0]}`,
					domain: clientState.domain,
					...options,
					session: `invalid`,
					transport,
				}),
			).toThrow(`positive safe integer`)
		}

		const stateListener = vi.fn()
		const stopState = client.subscribeState(stateListener)
		const stopThrowingState = client.subscribeState(() => {
			throw new Error(`state observer failed`)
		})
		const address = clientState.domain.address(`values`, `hydrated`)
		await client.hydrate({ addresses: [address], kind: `members` })
		stopThrowingState()
		expect(client.state).toMatchObject({
			requestedMemberCount: 0,
			residentMemberCount: 1,
		})
		await expect(
			client.submit({
				address,
				operation: { type: `set`, value: 1 },
			}),
		).rejects.toThrow(`acquired, hydrated member`)
		await expect(client.evict(address)).resolves.toBe(true)
		await expect(client.evict(address)).resolves.toBe(false)
		await expect(
			client.acquire(clientState.domain.address(`cursor`, `alice`)),
		).rejects.toThrow(`durable members only`)
		await expect(client.submit([])).rejects.toThrow(`requires an operation`)

		const fixed = await client.acquire(clientState.domain.address(`fixed`))
		await expect(
			client.submit({
				address: fixed.address,
				operation: { type: `set`, value: 1 },
			}),
		).rejects.toThrow(`no batch model`)
		fixed[Symbol.dispose]()
		fixed.release()
		await waitFor(() => !fixed.active)
		await expect(client.evict(fixed.address)).rejects.toThrow(
			`singleton Mosaic Domain member`,
		)

		const subscription = await client.subscribe({
			addresses: [clientState.domain.address(`values`, `subscribed`)],
			kind: `members`,
		})
		expect(subscription.active).toBe(true)
		subscription[Symbol.dispose]()
		await waitFor(() => !subscription.active)
		await subscription.release()
		stopState()
		expect(stateListener).toHaveBeenCalled()
		client[Symbol.dispose]()
		await waitFor(() => client.state.residentMemberCount === 0)
		await client.dispose()
		await expect(client.acquire(address)).rejects.toThrow(`disposed`)
		await expect(
			client.submit({
				address,
				operation: { type: `set`, value: 1 },
			}),
		).rejects.toThrow(`disposed`)
		await expect(
			client.subscribe({ addresses: [address], kind: `members` }),
		).rejects.toThrow(`disposed`)
	})

	test(`fails closed on malformed checkpoints without allocating members`, async () => {
		type Checkpoint = {
			headRevision: number
			members: any[]
			resolutions: any[]
		}
		const cases: readonly {
			readonly expected: string
			readonly maxResidentBytes?: number
			readonly mutate: (
				checkpoint: Checkpoint,
				state: Awaited<ReturnType<typeof residencyFixture>>,
			) => unknown
		}[] = [
			{
				expected: `revision is invalid`,
				mutate: (checkpoint) => ({ ...checkpoint, headRevision: -1 }),
			},
			{
				expected: `resolution is invalid`,
				mutate: (checkpoint) => {
					checkpoint.resolutions[0].requestId = ``
					return checkpoint
				},
			},
			{
				expected: `resolution is invalid`,
				mutate: (checkpoint) => {
					checkpoint.resolutions[0].revisionToken = ``
					return checkpoint
				},
			},
			{
				expected: `resolution is invalid`,
				mutate: (checkpoint) => {
					checkpoint.resolutions.push(structuredClone(checkpoint.resolutions[0]))
					return checkpoint
				},
			},
			{
				expected: `checkpoint is incomplete`,
				mutate: (checkpoint) => ({ ...checkpoint, resolutions: [] }),
			},
			{
				expected: `non-durable member`,
				mutate: (checkpoint, state) => {
					const cursor = state.domain.address(`cursor`, `alice`)
					checkpoint.resolutions[0].addresses = [cursor]
					checkpoint.members = [{ address: cursor, value: 0 }]
					return checkpoint
				},
			},
			{
				expected: `checkpoint member is invalid`,
				mutate: (checkpoint) => ({ ...checkpoint, members: [null] }),
			},
			{
				expected: `checkpoint member is invalid`,
				mutate: (checkpoint, state) => {
					checkpoint.members[0].address = state.domain.address(`values`, `other`)
					return checkpoint
				},
			},
			{
				expected: `checkpoint member is invalid`,
				mutate: (checkpoint) => {
					checkpoint.members.push(structuredClone(checkpoint.members[0]))
					return checkpoint
				},
			},
			{
				expected: `checkpoint is incomplete`,
				mutate: (checkpoint) => ({ ...checkpoint, members: [] }),
			},
			{
				expected: `resident bytes exceed 1`,
				maxResidentBytes: 1,
				mutate: (checkpoint) => {
					checkpoint.members[0].value = 100
					return checkpoint
				},
			},
		]
		for (let index = 0; index < cases.length; index++) {
			const testCase = cases[index]
			const state = await residencyFixture(`residency-checkpoint-${index}`)
			const address = state.domain.address(`values`, `member`)
			const atomsBefore = state.silo.store.atoms.size
			const client = createMosaicDomainResidencyClient({
				actor: `reader`,
				domain: state.domain,
				...(testCase.maxResidentBytes === undefined
					? {}
					: { maxResidentBytes: testCase.maxResidentBytes }),
				session: `session-${index}`,
				transport: {
					hydrate(requests) {
						const checkpoint: Checkpoint = {
							headRevision: 1,
							members: [{ address, value: 0 }],
							resolutions: [
								{
									addresses: [address],
									requestId: requests[0].id,
									revisionToken: `revision:1`,
								},
							],
						}
						return Promise.resolve(testCase.mutate(checkpoint, state) as never)
					},
					propose: () => Promise.reject(new Error(`unused`)),
					subscribe: () => () => {},
				},
			})
			await expect(client.acquire(address)).rejects.toThrow(testCase.expected)
			expect(state.silo.store.atoms.size).toBe(atomsBefore)
			await client.dispose()
		}

		const emptyState = await residencyFixture(`residency-checkpoint-empty`)
		const emptyAddress = emptyState.domain.address(`values`, `empty`)
		const emptyClient = createMosaicDomainResidencyClient({
			actor: `reader`,
			domain: emptyState.domain,
			session: `empty`,
			transport: {
				hydrate: (requests) =>
					Promise.resolve({
						headRevision: 0,
						members: [],
						resolutions: [
							{
								addresses: [],
								requestId: requests[0].id,
								revisionToken: `revision:0`,
							},
						],
					}),
				propose: () => Promise.reject(new Error(`unused`)),
				subscribe: () => () => {},
			},
		})
		await expect(emptyClient.acquire(emptyAddress)).rejects.toThrow(
			`acquisition returned no member`,
		)
		await emptyClient.dispose()
	})

	test(`rejects stale one-shot hydration without replacing newer state`, async () => {
		const state = await residencyFixture(`residency-stale-hydration`)
		const address = state.domain.address(`values`, `member`)
		let revision = 2
		let value = 2
		const client = createMosaicDomainResidencyClient({
			actor: `reader`,
			domain: state.domain,
			session: `session-reader`,
			transport: {
				hydrate: (requests) =>
					Promise.resolve({
						headRevision: revision,
						members: [{ address, value }],
						resolutions: [
							{
								addresses: [address],
								requestId: requests[0].id,
								revisionToken: `revision:${revision}`,
							},
						],
					}),
				propose: () => Promise.reject(new Error(`unused`)),
				subscribe: () => () => {},
			},
		})
		await client.hydrate({ addresses: [address], kind: `members` })
		revision = 1
		value = 1
		await expect(
			client.hydrate({ addresses: [address], kind: `members` }),
		).rejects.toThrow(`moved backwards`)
		expect(state.silo.getState(await tokenFor(state, `member`))).toBe(2)
		await client.dispose()
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
		await client.submit({
			address,
			operation: { type: `set`, value: 42 },
		})
		expect(client.state.pendingBatchIds).toHaveLength(2)
		lease.release()
		await settle()
		await expect(client.evict(address)).resolves.toBe(true)
		expect(client.state).toMatchObject({
			pendingBatchIds: [expect.any(String), expect.any(String)],
			residentMemberCount: 0,
		})

		offline = false
		await client.reconnect()
		expect(client.state.pendingBatchIds).toEqual([])
		expect(client.state.residentMemberCount).toBe(0)
		const reacquired = await client.acquire(address)
		expect(clientState.silo.getState(reacquired.token)).toBe(42)
		await client.dispose()
		expect(clientState.silo.store.atoms.has(reacquired.token.key)).toBe(false)
		expect(cleaned).toEqual([`offline-member`, `offline-member`])
		expect(
			serverState.silo.getState(serverState.valueAtoms, `offline-member`),
		).toBe(42)
	})

	test(`keeps optimism intact when proposal receipts are malformed`, async () => {
		const serverState = await residencyFixture(`residency-server-receipts`)
		const batches = createMosaicDomainBatchServer({ domain: serverState.domain })
		const server = createMosaicDomainResidencyServer({
			batches,
			domain: serverState.domain,
		})
		const cases: readonly {
			readonly expected: string
			readonly result: (proposal: MosaicDomainBatchProposal) => unknown
		}[] = [
			{
				expected: `proposal result is invalid`,
				result: () => ({ status: `unknown` }),
			},
			{
				expected: `acceptance receipt is invalid`,
				result: (proposal) => ({
					accepted: {
						batch: { ...proposal, actor: `intruder` },
						revision: 1,
					},
					status: `accepted`,
				}),
			},
			{
				expected: `rejection is invalid`,
				result: (proposal) => ({
					rejection: { batchId: proposal.id },
					status: `rejected`,
				}),
			},
			{
				expected: `rejection is invalid`,
				result: () => ({
					rejection: {
						batchId: `another-batch`,
						code: `unauthorized`,
						reason: `denied`,
						recovery: `discard-batch`,
					},
					status: `rejected`,
				}),
			},
		]
		for (let index = 0; index < cases.length; index++) {
			const testCase = cases[index]
			const state = await residencyFixture(`residency-client-receipt-${index}`)
			const connected = server.connect({
				actor: `actor-${index}`,
				session: `session-${index}`,
			})
			const client = createMosaicDomainResidencyClient({
				actor: `actor-${index}`,
				domain: state.domain,
				session: `session-${index}`,
				transport: {
					dispose: () => connected.dispose?.(),
					hydrate: (requests) => connected.hydrate(requests),
					propose: (proposal) =>
						Promise.resolve(testCase.result(proposal) as never),
					subscribe: (requests, listener) =>
						connected.subscribe(requests, listener),
				},
			})
			const lease = await client.acquire(
				state.domain.address(`values`, `member-${index}`),
			)
			await expect(
				client.submit({
					address: lease.address,
					operation: { type: `set`, value: 5 },
				}),
			).rejects.toThrow(testCase.expected)
			expect(state.silo.getState(lease.token)).toBe(5)
			expect(client.state).toMatchObject({
				connectivity: `offline`,
				pendingBatchIds: [expect.any(String)],
			})
			await client.dispose()
		}
	})

	test(`settles a valid rejection by rolling back its entire optimistic batch`, async () => {
		const serverState = await residencyFixture(`residency-server-rejection`)
		const clientState = await residencyFixture(`residency-client-rejection`)
		const batches = createMosaicDomainBatchServer({ domain: serverState.domain })
		const server = createMosaicDomainResidencyServer({
			batches,
			domain: serverState.domain,
		})
		const connected = server.connect({ actor: `alice`, session: `session-a` })
		const client = createMosaicDomainResidencyClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: {
				dispose: () => connected.dispose?.(),
				hydrate: (requests) => connected.hydrate(requests),
				propose: (proposal) =>
					Promise.resolve({
						rejection: {
							batchId: proposal.id,
							code: `unauthorized` as const,
							reason: `denied`,
							recovery: `discard-batch` as const,
						},
						status: `rejected` as const,
					}),
				subscribe: (requests, listener) =>
					connected.subscribe(requests, listener),
			},
		})
		const lease = await client.acquire(
			clientState.domain.address(`values`, `rejected`),
		)
		await client.submit({
			address: lease.address,
			operation: { type: `set`, value: 9 },
		})
		expect(clientState.silo.getState(lease.token)).toBe(0)
		expect(client.state).toMatchObject({
			connectivity: `live`,
			pendingBatchIds: [],
			problem: { code: `unauthorized` },
		})
		await client.dispose()
	})

	test(`recovers after hydration failure and rejects malformed live events`, async () => {
		const serverState = await residencyFixture(
			`residency-server-recovery-errors`,
		)
		const clientState = await residencyFixture(
			`residency-client-recovery-errors`,
		)
		const batches = createMosaicDomainBatchServer({ domain: serverState.domain })
		const server = createMosaicDomainResidencyServer({
			batches,
			domain: serverState.domain,
		})
		const connected = server.connect({ actor: `alice`, session: `session-a` })
		let failHydration = true
		let liveListener:
			| Parameters<
					MosaicDomainResidencyTransport<
						typeof clientState.domain.identity
					>[`subscribe`]
			  >[1]
			| undefined
		let stops = 0
		const client = createMosaicDomainResidencyClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: {
				dispose: () => connected.dispose?.(),
				hydrate(requests) {
					if (failHydration) {
						failHydration = false
						return Promise.reject(new Error(`checkpoint unavailable`))
					}
					return connected.hydrate(requests)
				},
				propose: (proposal) => connected.propose(proposal),
				subscribe(_requests, listener) {
					liveListener = listener
					const ordinal = stops
					return () => {
						stops++
						if (ordinal === 0) throw new Error(`failed subscription stop`)
					}
				},
			},
		})
		const address = clientState.domain.address(`values`, `member`)
		await expect(client.acquire(address)).rejects.toThrow(
			`checkpoint unavailable`,
		)
		expect(client.state.connectivity).toBe(`offline`)
		const lease = await client.acquire(address)
		expect(clientState.silo.getState(lease.token)).toBe(0)
		liveListener?.(null as never)
		await waitFor(() => client.state.connectivity === `offline`)
		expect(client.state.pendingBatchIds).toEqual([])
		await client.dispose()
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
				throw new Error(`selection observer failed`)
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

	test(`bounds catch-up buffering and replaces throwing subscriptions`, async () => {
		const serverState = await residencyFixture(`residency-server-buffer`)
		const readerState = await residencyFixture(`residency-reader-buffer`)
		const writerState = await residencyFixture(`residency-writer-buffer`)
		const batches = createMosaicDomainBatchServer({ domain: serverState.domain })
		const server = createMosaicDomainResidencyServer({
			batches,
			domain: serverState.domain,
		})
		const writer = createMosaicDomainResidencyClient({
			actor: `writer`,
			domain: writerState.domain,
			session: `session-writer`,
			transport: server.connect({ actor: `writer`, session: `session-writer` }),
		})
		const writerLease = await writer.acquire(
			writerState.domain.address(`values`, `buffered`),
		)
		const connected = server.connect({
			actor: `reader`,
			session: `session-reader`,
		})
		let deliveries = 0
		let hydrateCalls = 0
		let subscriptionCount = 0
		let throwingStops = 0
		const reader = createMosaicDomainResidencyClient({
			actor: `reader`,
			domain: readerState.domain,
			maxBufferedAcceptances: 1,
			session: `session-reader`,
			transport: {
				dispose: () => connected.dispose?.(),
				async hydrate(requests) {
					hydrateCalls++
					const checkpoint = await connected.hydrate(requests)
					if (hydrateCalls === 1) {
						await writer.submit({
							address: writerLease.address,
							operation: { type: `set`, value: 1 },
						})
						await writer.submit({
							address: writerLease.address,
							operation: { type: `set`, value: 2 },
						})
						await waitFor(() => deliveries === 2)
					}
					return checkpoint
				},
				propose: (batch) => connected.propose(batch),
				async subscribe(requests, listener) {
					subscriptionCount++
					const ordinal = subscriptionCount
					const stop = await connected.subscribe(requests, (accepted) => {
						deliveries++
						listener(accepted)
					})
					return () => {
						stop()
						if (ordinal === 1) {
							throwingStops++
							throw new Error(`old subscription stop failed`)
						}
					}
				},
			},
		})
		const lease = await reader.acquire(
			readerState.domain.address(`values`, `buffered`),
		)

		expect(readerState.silo.getState(lease.token)).toBe(2)
		expect(reader.state).toMatchObject({
			connectivity: `live`,
			headRevision: 2,
			residentMemberCount: 1,
		})
		expect(hydrateCalls).toBe(2)
		expect(subscriptionCount).toBe(2)
		expect(throwingStops).toBe(1)
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
