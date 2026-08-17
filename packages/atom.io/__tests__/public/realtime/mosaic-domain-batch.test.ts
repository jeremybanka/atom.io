import { Silo } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import {
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
	mosaicDomain,
	type MosaicDomainBatchEnvelope,
	type MosaicDomainBatchProposal,
	mosaicDomainMemberModelIdentity,
	type MosaicDomainTransceiverModel,
	type MosaicDomainValueModel,
	type MosaicOperationSignal,
	mosaicText,
	type MosaicTextOperation,
	type MosaicTextSnapshot,
} from "atom.io/realtime"
import {
	createMosaicDomainBatchClient,
	type MosaicDomainBatchClientTransport,
} from "atom.io/realtime-client"
import {
	createMosaicDomainBatchServer,
	InMemoryMosaicDomainBatchStorage,
} from "atom.io/realtime-server"
import { testMosaicDomainBatchStorageAdapter } from "atom.io/realtime-testing"
import { headless } from "atom.io/realtime-testing/headless"
import { z } from "zod"

const pathModel = {
	identity: { key: `path-order`, version: 1 },
	kind: `value`,
	operationSchema: z.object({ path: z.string(), type: z.literal(`append`) }),
	reduce(value, operation) {
		return value.includes(operation.path) ? value : [...value, operation.path]
	},
} satisfies MosaicDomainValueModel<string[], { path: string; type: `append` }>

type Node = { x: number; y: number }

const nodeModel = {
	identity: { key: `node-register`, version: 1 },
	kind: `value`,
	operationSchema: z.object({
		type: z.literal(`move`),
		x: z.number(),
		y: z.number(),
	}),
	reduce(_value, operation) {
		return { x: operation.x, y: operation.y }
	},
} satisfies MosaicDomainValueModel<Node, { type: `move`; x: number; y: number }>

async function designFixture(
	name: string,
	silo = new Silo({ isProduction: false, lifespan: `ephemeral`, name }),
) {
	const pathsAtom = silo.atom<string[]>({ default: [], key: `paths` })
	const nodeAtoms = silo.atomFamily<Node, string>({
		default: { x: 0, y: 0 },
		key: `node`,
	})
	const summarySelector = silo.selector<{
		node: Node
		paths: readonly string[]
	}>({
		get: ({ get }) => ({
			node: get(nodeAtoms, `n1`),
			paths: get(pathsAtom),
		}),
		key: `summary`,
	})
	const definition = mosaicDomain({
		configSchema: z.object({}),
		key: `mos11-design`,
		members: {
			nodes: {
				keySchema: z.string(),
				model: nodeModel,
				role: `durable`,
				schema: z.object({ x: z.number(), y: z.number() }),
				token: nodeAtoms,
			},
			paths: {
				model: pathModel,
				role: `durable`,
				schema: z.array(z.string()),
				token: pathsAtom,
			},
		},
		version: 1,
	})
	const domain = await definition.activate({
		config: {},
		instance: `document`,
		store: silo.store,
	})
	return { domain, nodeAtoms, pathsAtom, silo, summarySelector }
}

async function revisionFixture(name: string) {
	const silo = new Silo({ isProduction: false, lifespan: `ephemeral`, name })
	const revisionAtom = silo.atom<number>({ default: 0, key: `revision` })
	const revisionModel = {
		identity: { key: `revision-stamp`, version: 1 },
		kind: `value`,
		operationSchema: z.object({ type: z.literal(`stamp`) }),
		reduce(_value, _operation, context) {
			return context.revision ?? -1
		},
	} satisfies MosaicDomainValueModel<number, { type: `stamp` }>
	const definition = mosaicDomain({
		configSchema: z.object({}),
		key: `mos11-revision`,
		members: {
			revision: {
				model: revisionModel,
				role: `durable`,
				schema: z.number(),
				token: revisionAtom,
			},
		},
		version: 1,
	})
	const domain = await definition.activate({
		config: {},
		instance: `document`,
		store: silo.store,
	})
	return { domain, revisionAtom, silo }
}

const BatchText = mosaicText()

async function textFixture(name: string) {
	const silo = new Silo({ isProduction: false, lifespan: `ephemeral`, name })
	const textAtom = silo.mutableAtom<InstanceType<typeof BatchText>>({
		class: BatchText,
		key: `text`,
	})
	const textModel = {
		class: BatchText,
		kind: `transceiver`,
		operationSchema: z.custom<MosaicTextOperation>(
			(value) => typeof value === `object` && value !== null,
		),
	} satisfies MosaicDomainTransceiverModel<InstanceType<typeof BatchText>>
	const definition = mosaicDomain({
		configSchema: z.object({}),
		key: `mos11-text`,
		members: {
			text: {
				model: textModel,
				role: `durable`,
				schema: z.custom<MosaicTextSnapshot>(
					(value) => typeof value === `object` && value !== null,
				),
				token: textAtom,
			},
		},
		version: 1,
	})
	const domain = await definition.activate({
		config: {},
		instance: `document`,
		store: silo.store,
	})
	return { domain, silo, textAtom }
}

const proposal = (
	domain: Awaited<ReturnType<typeof designFixture>>[`domain`],
	overrides: Partial<MosaicDomainBatchProposal> = {},
): MosaicDomainBatchProposal => {
	const paths = domain.address(`paths`)
	const node = domain.address(`nodes`, `n1`)
	return {
		affectedMembers: [paths, node],
		dependencies: [],
		domain: domain.identity,
		group: `gesture-1`,
		id: `batch-1`,
		operations: [
			{
				address: paths,
				id: `operation-path`,
				model: mosaicDomainMemberModelIdentity(pathModel),
				operation: { path: `p1`, type: `append` },
			},
			{
				address: node,
				id: `operation-node`,
				model: mosaicDomainMemberModelIdentity(nodeModel),
				operation: { type: `move`, x: 10, y: 20 },
			},
		],
		protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
		session: `session-a`,
		...overrides,
	}
}

async function waitFor(
	condition: () => boolean,
	message: string,
): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (condition()) return
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
	}
	throw new Error(message)
}

describe(`Mosaic Domain atomic batches`, () => {
	test(`settles heterogeneous members atomically for several clients`, async () => {
		const serverState = await designFixture(`server`)
		const aliceState = await designFixture(`alice`)
		const bobState = await designFixture(`bob`)
		const server = createMosaicDomainBatchServer({ domain: serverState.domain })
		const alice = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: aliceState.domain,
			session: `session-a`,
			transport: server.connect({ actor: `alice`, session: `session-a` }),
		})
		const bob = createMosaicDomainBatchClient({
			actor: `bob`,
			domain: bobState.domain,
			session: `session-b`,
			transport: server.connect({ actor: `bob`, session: `session-b` }),
		})
		await Promise.all([alice.start(), bob.start()])

		const observations: Json.Serializable[] = []
		bobState.silo.subscribe(bobState.summarySelector, () => {
			observations.push(bobState.silo.getState(bobState.summarySelector))
		})
		await alice.submit(
			[
				{
					address: aliceState.domain.address(`paths`),
					operation: { path: `p1`, type: `append` },
				},
				{
					address: aliceState.domain.address(`nodes`, `n1`),
					operation: { type: `move`, x: 10, y: 20 },
				},
			],
			`draw-p1`,
		)
		await waitFor(
			() => bob.state.revision === 1,
			`Bob did not receive revision 1`,
		)

		for (const state of [serverState, aliceState, bobState]) {
			expect(state.silo.getState(state.pathsAtom)).toEqual([`p1`])
			expect(state.silo.getState(state.nodeAtoms, `n1`)).toEqual({
				x: 10,
				y: 20,
			})
		}
		expect(observations).toEqual([{ node: { x: 10, y: 20 }, paths: [`p1`] }])
	})

	test(`composes with realtime-testing's arbitrary multi-client topology`, async () => {
		const scenario = headless({
			scenarioId: `mos11-batch`,
			server: () => undefined,
		})
		const aliceHarness = scenario.createClient({ name: `alice` })
		const bobHarness = scenario.createClient({ name: `bob` })
		try {
			await scenario.waitForIdle()
			const serverState = await designFixture(
				`server-harness`,
				scenario.server.silo,
			)
			const aliceState = await designFixture(`alice-harness`, aliceHarness.silo)
			const bobState = await designFixture(`bob-harness`, bobHarness.silo)
			const server = createMosaicDomainBatchServer({
				domain: serverState.domain,
			})
			const alice = createMosaicDomainBatchClient({
				actor: aliceHarness.userKey,
				domain: aliceState.domain,
				session: aliceHarness.sessionId,
				transport: server.connect({
					actor: aliceHarness.userKey,
					session: aliceHarness.sessionId,
				}),
			})
			const bob = createMosaicDomainBatchClient({
				actor: bobHarness.userKey,
				domain: bobState.domain,
				session: bobHarness.sessionId,
				transport: server.connect({
					actor: bobHarness.userKey,
					session: bobHarness.sessionId,
				}),
			})
			await Promise.all([alice.start(), bob.start()])
			await aliceHarness.work.track(
				alice.submit([
					{
						address: aliceState.domain.address(`paths`),
						operation: { path: `from-harness`, type: `append` },
					},
					{
						address: aliceState.domain.address(`nodes`, `n1`),
						operation: { type: `move`, x: 7, y: 8 },
					},
				]),
				`submit Mosaic Domain batch`,
			)

			const converged = await scenario.waitForConvergence({
				participants: [
					{
						label: `server`,
						read: () => serverState.silo.getState(serverState.summarySelector),
					},
					{
						label: `alice`,
						read: () => aliceState.silo.getState(aliceState.summarySelector),
					},
					{
						label: `bob`,
						read: () => bobState.silo.getState(bobState.summarySelector),
					},
				],
			})
			expect(converged).toEqual({
				node: { x: 7, y: 8 },
				paths: [`from-harness`],
			})
		} finally {
			await scenario.teardown()
		}
	})

	test(`replaces provisional metadata with the accepted revision without rollback flicker`, async () => {
		const serverState = await revisionFixture(`server-revision`)
		const clientState = await revisionFixture(`client-revision`)
		const server = createMosaicDomainBatchServer({ domain: serverState.domain })
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: server.connect({ actor: `alice`, session: `session-a` }),
		})
		await client.start()
		const observations: number[] = []
		clientState.silo.subscribe(clientState.revisionAtom, () => {
			observations.push(clientState.silo.getState(clientState.revisionAtom))
		})

		await client.submit({
			address: clientState.domain.address(`revision`),
			operation: { type: `stamp` },
		})

		expect(clientState.silo.getState(clientState.revisionAtom)).toBe(1)
		expect(serverState.silo.getState(serverState.revisionAtom)).toBe(1)
		expect(observations).toEqual([-1, 1])
	})

	test(`settles append-only transceiver operations through the batch`, async () => {
		const serverState = await textFixture(`server-text`)
		const clientState = await textFixture(`client-text`)
		const server = createMosaicDomainBatchServer({ domain: serverState.domain })
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: server.connect({ actor: `alice`, session: `session-a` }),
		})
		await client.start()
		const preparation = new BatchText()
		const signal = preparation.change(
			{ text: `Collaborative`, type: `replace-text` },
			{
				actor: `alice`,
				dependencies: [],
				group: `typing`,
				id: `text-operation`,
				now: 0,
				revision: null,
				session: `session-a`,
			},
		) as MosaicOperationSignal<MosaicTextOperation>

		await client.submit(
			{
				address: clientState.domain.address(`text`),
				id: signal.id,
				operation: signal.operation,
			},
			signal.group,
		)

		expect({
			client: clientState.silo.getState(clientState.textAtom).text,
			clientState: client.state,
			server: serverState.silo.getState(serverState.textAtom).text,
		}).toEqual({
			client: `Collaborative`,
			clientState: expect.objectContaining({ revision: 1, status: `live` }),
			server: `Collaborative`,
		})
	})

	test(`rolls back every optimistic member when authorization rejects the final operation`, async () => {
		const serverState = await designFixture(`server-reject`)
		const clientState = await designFixture(`client-reject`)
		const server = createMosaicDomainBatchServer({
			authorize: ({ batch }) =>
				(batch.operations.at(-1)?.operation as { x?: number }).x !== 999,
			domain: serverState.domain,
		})
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: server.connect({ actor: `alice`, session: `session-a` }),
		})
		await client.start()
		const observations: Array<ReturnType<typeof clientState.silo.getState>> = []
		clientState.silo.subscribe(clientState.summarySelector, () => {
			observations.push(clientState.silo.getState(clientState.summarySelector))
		})

		await client.submit([
			{
				address: clientState.domain.address(`paths`),
				operation: { path: `rejected`, type: `append` },
			},
			{
				address: clientState.domain.address(`nodes`, `n1`),
				operation: { type: `move`, x: 999, y: 999 },
			},
		])

		expect(client.state.status).toBe(`rejected`)
		expect(client.state.pendingBatchIds).toEqual([])
		expect(clientState.silo.getState(clientState.summarySelector)).toEqual({
			node: { x: 0, y: 0 },
			paths: [],
		})
		expect(server.revision).toBe(0)
		expect(observations).toEqual([
			{ node: { x: 999, y: 999 }, paths: [`rejected`] },
			{ node: { x: 0, y: 0 }, paths: [] },
		])
	})

	test(`emits no Store or transport signal when final local preflight rolls back`, async () => {
		const state = await designFixture(`client-local-rollback`)
		let proposals = 0
		const transport: MosaicDomainBatchClientTransport = {
			propose() {
				proposals++
				throw new Error(`A rejected preflight must not reach transport.`)
			},
			recover() {
				return Promise.resolve({ headRevision: 0, tail: [] })
			},
			subscribe() {
				return () => undefined
			},
		}
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: state.domain,
			session: `session-a`,
			transport,
		})
		await client.start()
		let notifications = 0
		state.silo.subscribe(state.summarySelector, () => notifications++)

		await expect(
			client.submit([
				{
					address: state.domain.address(`paths`),
					operation: { path: `never-visible`, type: `append` },
				},
				{
					address: state.domain.address(`nodes`, `n1`),
					operation: { type: `move`, x: `invalid`, y: 1 },
				},
			]),
		).rejects.toThrow(`failed validation`)
		expect(notifications).toBe(0)
		expect(proposals).toBe(0)
		expect(state.silo.getState(state.summarySelector)).toEqual({
			node: { x: 0, y: 0 },
			paths: [],
		})
	})

	test(`does not acknowledge pending work from a reused accepted batch ID`, async () => {
		const state = await designFixture(`client-forged-acknowledgement`)
		const transport: MosaicDomainBatchClientTransport = {
			propose(batch) {
				return Promise.resolve({
					accepted: {
						batch: {
							...batch,
							actor: `mallory`,
						},
						revision: 1,
					},
					status: `accepted` as const,
				})
			},
			recover() {
				return Promise.resolve({ headRevision: 0, tail: [] })
			},
			subscribe() {
				return () => undefined
			},
		}
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: state.domain,
			session: `session-a`,
			transport,
		})
		await client.submit({
			address: state.domain.address(`paths`),
			operation: { path: `forged`, type: `append` },
		})

		expect(client.state).toMatchObject({
			pendingBatchIds: [`alice:session-a:batch:0`],
			problem: { code: `batch-id-collision`, recovery: `resnapshot` },
			revision: 0,
			status: `rejected`,
		})
		expect(state.silo.getState(state.pathsAtom)).toEqual([])
	})

	test(`fails closed when recovery reuses a pending batch ID`, async () => {
		const state = await designFixture(`client-forged-recovery`)
		let recoverPending = false
		let pendingProposal: MosaicDomainBatchProposal | undefined
		const transport: MosaicDomainBatchClientTransport = {
			propose(batch) {
				pendingProposal = batch
				return Promise.reject(new Error(`offline`))
			},
			recover() {
				if (!recoverPending || pendingProposal === undefined) {
					return Promise.resolve({ headRevision: 0, tail: [] })
				}
				return Promise.resolve({
					headRevision: 1,
					tail: [
						{
							batch: { ...pendingProposal, actor: `mallory` },
							revision: 1,
						},
					],
				})
			},
			subscribe() {
				return () => undefined
			},
		}
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: state.domain,
			session: `session-a`,
			transport,
		})
		await client.start()
		await client.submit({
			address: state.domain.address(`paths`),
			operation: { path: `pending`, type: `append` },
		})
		expect(state.silo.getState(state.pathsAtom)).toEqual([`pending`])

		recoverPending = true
		await client.flush()

		expect(client.state).toMatchObject({
			pendingBatchIds: [`alice:session-a:batch:0`],
			problem: { code: `batch-id-collision`, recovery: `resnapshot` },
			revision: 0,
			status: `rejected`,
		})
		expect(state.silo.getState(state.pathsAtom)).toEqual([])
	})

	test(`deduplicates batches and fails closed on conflicting batch or operation IDs`, async () => {
		const state = await designFixture(`server-deduplication`)
		const storage = new InMemoryMosaicDomainBatchStorage()
		const server = createMosaicDomainBatchServer({
			domain: state.domain,
			storage,
		})
		const connection = server.connect({ actor: `alice`, session: `session-a` })
		const first = proposal(state.domain)
		const accepted = await connection.propose(first)
		const duplicate = await connection.propose(structuredClone(first))
		expect(accepted.status).toBe(`accepted`)
		expect(duplicate).toEqual(accepted)
		expect(server.revision).toBe(1)

		const batchCollision = await connection.propose({
			...first,
			operations: first.operations.map((operation, index) =>
				index === 0
					? { ...operation, operation: { path: `different`, type: `append` } }
					: operation,
			),
		})
		expect(batchCollision).toMatchObject({
			rejection: { code: `batch-id-collision` },
			status: `rejected`,
		})

		const operationCollision = await connection.propose({
			...first,
			affectedMembers: [first.affectedMembers[0]],
			dependencies: [first.id],
			id: `batch-2`,
			operations: [
				{
					...first.operations[0],
					operation: { path: `p2`, type: `append` },
				},
			],
		})
		expect(operationCollision).toMatchObject({
			rejection: { code: `operation-id-collision` },
			status: `rejected`,
		})
		expect((await storage.recover(state.domain.identity)).tail).toHaveLength(1)
	})

	test(`recovers a dropped batch boundary before applying a later revision`, async () => {
		const serverState = await designFixture(`server-gap`)
		const aliceState = await designFixture(`alice-gap`)
		const bobState = await designFixture(`bob-gap`)
		const server = createMosaicDomainBatchServer({ domain: serverState.domain })
		const alice = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: aliceState.domain,
			session: `session-a`,
			transport: server.connect({ actor: `alice`, session: `session-a` }),
		})
		const bobConnection = server.connect({ actor: `bob`, session: `session-b` })
		const droppedFirst: MosaicDomainBatchClientTransport = {
			...bobConnection,
			subscribe(listener) {
				return bobConnection.subscribe((accepted) => {
					if (accepted.revision !== 1) listener(accepted)
				})
			},
		}
		const bob = createMosaicDomainBatchClient({
			actor: `bob`,
			domain: bobState.domain,
			session: `session-b`,
			transport: droppedFirst,
		})
		await Promise.all([alice.start(), bob.start()])
		await alice.submit({
			address: aliceState.domain.address(`paths`),
			operation: { path: `p1`, type: `append` },
		})
		await alice.submit({
			address: aliceState.domain.address(`paths`),
			operation: { path: `p2`, type: `append` },
		})
		await waitFor(() => bob.state.revision === 2, `Bob did not recover the gap`)
		expect(bobState.silo.getState(bobState.pathsAtom)).toEqual([`p1`, `p2`])
	})

	test(`retains one whole offline batch and replays it idempotently`, async () => {
		const serverState = await designFixture(`server-offline`)
		const clientState = await designFixture(`client-offline`)
		const server = createMosaicDomainBatchServer({ domain: serverState.domain })
		const connection = server.connect({ actor: `alice`, session: `session-a` })
		let offline = true
		const transport: MosaicDomainBatchClientTransport = {
			...connection,
			async propose(batch) {
				if (offline) throw new Error(`offline`)
				return connection.propose(batch)
			},
		}
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport,
		})
		await client.start()
		await client.submit([
			{
				address: clientState.domain.address(`paths`),
				operation: { path: `offline`, type: `append` },
			},
			{
				address: clientState.domain.address(`nodes`, `n1`),
				operation: { type: `move`, x: 4, y: 5 },
			},
		])
		expect(client.state.status).toBe(`offline`)
		expect(client.state.pendingBatchIds).toHaveLength(1)
		offline = false
		await client.flush()
		expect(client.state).toMatchObject({
			pendingBatchIds: [],
			revision: 1,
			status: `live`,
		})
		expect(serverState.silo.getState(serverState.summarySelector)).toEqual({
			node: { x: 4, y: 5 },
			paths: [`offline`],
		})
	})

	test(`storage append reserves every operation ID or none`, async () => {
		const state = await designFixture(`storage-atomicity`)
		const storage = new InMemoryMosaicDomainBatchStorage()
		const firstProposal = proposal(state.domain)
		const first: MosaicDomainBatchEnvelope = {
			...firstProposal,
			actor: `alice`,
		}
		await storage.appendBatch({
			accepted: { batch: first, revision: 1 },
			expectedRevision: 0,
			fingerprint: `first`,
		})
		const second: MosaicDomainBatchEnvelope = {
			...first,
			affectedMembers: [first.affectedMembers[0]],
			dependencies: [first.id],
			id: `batch-2`,
			operations: [
				{ ...first.operations[0], id: `new-operation` },
				{ ...first.operations[0], id: `operation-node` },
			],
		}
		const result = await storage.appendBatch({
			accepted: { batch: second, revision: 2 },
			expectedRevision: 1,
			fingerprint: `second`,
		})
		expect(result).toMatchObject({ collision: `operation`, status: `collision` })
		expect(await storage.receipt(state.domain.identity, `batch-2`)).toBeNull()
		expect((await storage.recover(state.domain.identity)).headRevision).toBe(1)
	})

	test(`publishes a reusable storage-adapter conformance fixture`, async () => {
		await testMosaicDomainBatchStorageAdapter(
			() => new InMemoryMosaicDomainBatchStorage(),
		)
	})

	test(`bounds proposal work and reports queue backpressure`, async () => {
		const state = await designFixture(`server-limits`)
		let releaseAuthorization: (() => void) | undefined
		const authorization = new Promise<void>((resolve) => {
			releaseAuthorization = resolve
		})
		const server = createMosaicDomainBatchServer({
			authorize: async () => {
				await authorization
				return true
			},
			domain: state.domain,
			limits: { maxBytes: 4_096, maxPendingProposals: 1 },
		})
		const connection = server.connect({ actor: `alice`, session: `session-a` })
		const first = connection.propose(proposal(state.domain))
		const second = await connection.propose(
			proposal(state.domain, { id: `batch-queued` }),
		)
		expect(second).toMatchObject({
			rejection: { code: `backpressure`, recovery: `retry` },
			status: `rejected`,
		})
		releaseAuthorization?.()
		await expect(first).resolves.toMatchObject({ status: `accepted` })

		const oversized = await connection.propose(
			proposal(state.domain, {
				dependencies: [`batch-1`],
				id: `batch-oversized`,
				operations: [
					{
						...proposal(state.domain).operations[0],
						id: `operation-oversized`,
						operation: { path: `x`.repeat(8_192), type: `append` },
					},
				],
				affectedMembers: [proposal(state.domain).affectedMembers[0]],
			}),
		)
		expect(oversized).toMatchObject({
			rejection: { code: `capacity-exceeded` },
			status: `rejected`,
		})
		expect(server.revision).toBe(1)
	})

	test(`rejects malformed runtime proposals without entering the queue`, async () => {
		const state = await designFixture(`server-malformed`)
		const server = createMosaicDomainBatchServer({ domain: state.domain })
		const connection = server.connect({ actor: `alice`, session: `session-a` })

		await expect(connection.propose(null as never)).resolves.toMatchObject({
			rejection: { batchId: null, code: `invalid-payload` },
			status: `rejected`,
		})
		expect(server.revision).toBe(0)
	})

	test(`restarts from one contiguous batch tail without splitting members`, async () => {
		const firstState = await designFixture(`server-before-restart`)
		const storage = new InMemoryMosaicDomainBatchStorage()
		const firstServer = createMosaicDomainBatchServer({
			domain: firstState.domain,
			storage,
		})
		await firstServer
			.connect({ actor: `alice`, session: `session-a` })
			.propose(proposal(firstState.domain))
		firstServer.dispose()

		const restartedState = await designFixture(`server-after-restart`)
		const restarted = createMosaicDomainBatchServer({
			domain: restartedState.domain,
			storage,
		})
		await restarted.connect({ actor: `bob`, session: `session-b` }).recover(0)
		expect(restarted.revision).toBe(1)
		expect(restartedState.silo.getState(restartedState.summarySelector)).toEqual(
			{
				node: { x: 10, y: 20 },
				paths: [`p1`],
			},
		)
	})
})
