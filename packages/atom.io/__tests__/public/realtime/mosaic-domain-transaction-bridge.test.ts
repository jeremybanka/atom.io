import { Silo } from "atom.io"
import {
	mosaicDomain,
	type MosaicDomainTransceiverModel,
	type MosaicDomainValueModel,
	type MosaicOperationSignal,
	mosaicText,
	type MosaicTextOperation,
	type MosaicTextSnapshot,
	type StandardSchemaV1,
} from "atom.io/realtime"
import {
	createMosaicDomainBatchClient,
	createMosaicDomainTransactionBridge,
	type MosaicDomainBatchClientTransport,
} from "atom.io/realtime-client"
import { createMosaicDomainBatchServer } from "atom.io/realtime-server"
import { headless } from "atom.io/realtime-testing/headless"
import { vitest } from "vitest"
import { z } from "zod"

const Text = mosaicText()

function registerModel(
	operationSchema: StandardSchemaV1<
		unknown,
		{ from: number; to: number; type: `set` }
	> = z.object({
		from: z.number(),
		to: z.number(),
		type: z.literal(`set`),
	}),
) {
	return {
		encodeTransaction({ newValue, oldValue }) {
			return { from: oldValue, to: newValue, type: `set` as const }
		},
		identity: { key: `transaction-register`, version: 1 },
		kind: `value`,
		operationSchema,
		reduce(_value, operation) {
			return operation.to
		},
	} satisfies MosaicDomainValueModel<
		number,
		{ from: number; to: number; type: `set` }
	>
}

const textModel = {
	class: Text,
	encodeTransaction(signal) {
		return signal.operation
	},
	kind: `transceiver`,
	operationSchema: z.custom<MosaicTextOperation>(
		(value) => typeof value === `object` && value !== null,
	),
} satisfies MosaicDomainTransceiverModel<InstanceType<typeof Text>>

async function fixture(
	name: string,
	model: MosaicDomainValueModel<
		number,
		{ from: number; to: number; type: `set` }
	> = registerModel(),
	silo = new Silo({ isProduction: false, lifespan: `ephemeral`, name }),
	countKey = `count`,
) {
	// eslint-disable-next-line atom.io/naming-convention -- fixtures exercise arbitrary legal keys
	const countAtom = silo.atom<number>({ default: 0, key: countKey })
	const localAtom = silo.atom<number>({ default: 0, key: `local` })
	const textAtom = silo.mutableAtom<InstanceType<typeof Text>>({
		class: Text,
		key: `text`,
	})
	const definition = mosaicDomain({
		configSchema: z.object({}),
		key: `transaction-bridge`,
		members: {
			count: {
				model,
				role: `durable`,
				schema: z.number(),
				token: countAtom,
			},
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
	return { countAtom, domain, localAtom, silo, textAtom }
}

async function textFamilyFixture(name: string) {
	const silo = new Silo({ isProduction: false, lifespan: `ephemeral`, name })
	const textAtoms = silo.mutableAtomFamily<InstanceType<typeof Text>, string>({
		class: Text,
		key: `text`,
	})
	const definition = mosaicDomain({
		configSchema: z.object({}),
		key: `transaction-bridge-family`,
		members: {
			text: {
				keySchema: z.string(),
				model: textModel,
				role: `durable`,
				schema: z.custom<MosaicTextSnapshot>(
					(value) => typeof value === `object` && value !== null,
				),
				token: textAtoms,
			},
		},
		version: 1,
	})
	const domain = await definition.activate({
		config: {},
		instance: `document`,
		store: silo.store,
	})
	const textAtom = silo.findState(textAtoms, `chapter`)
	// Materializing the transceiver also establishes its JSON tracker.
	silo.getState(textAtom)
	return { domain, silo, textAtom }
}

function recordingTransport(transport: MosaicDomainBatchClientTransport) {
	const proposals: Parameters<MosaicDomainBatchClientTransport[`propose`]>[0][] =
		[]
	return {
		proposals,
		transport: {
			propose(batch) {
				proposals.push(structuredClone(batch))
				return transport.propose(batch)
			},
			recover: (after?: number) => transport.recover(after),
			subscribe: (listener) => transport.subscribe(listener),
		} satisfies MosaicDomainBatchClientTransport,
	}
}

describe(`Mosaic Domain transaction bridge`, () => {
	test(`adopts committed optimism without a second pre-ack Store commit`, async () => {
		const state = await fixture(`bridge-adoption-client`)
		let acceptedRevision = 0
		let proposed:
			| Parameters<MosaicDomainBatchClientTransport[`propose`]>[0]
			| undefined
		let observeProposal!: () => void
		const proposalObserved = new Promise<void>((resolve) => {
			observeProposal = resolve
		})
		let acceptProposal!: (
			result: Awaited<ReturnType<MosaicDomainBatchClientTransport[`propose`]>>,
		) => void
		const transport: MosaicDomainBatchClientTransport = {
			propose(batch) {
				proposed = batch
				observeProposal()
				return new Promise((resolve) => {
					acceptProposal = resolve
				})
			},
			recover() {
				return Promise.resolve({ headRevision: acceptedRevision, tail: [] })
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
		const updateTransaction = state.silo.transaction<() => void>({
			do: ({ set }) => {
				set(state.countAtom, 1)
			},
			key: `update`,
		})
		const bridge = createMosaicDomainTransactionBridge({
			client,
			domain: state.domain,
			transactions: [updateTransaction],
		})
		let commits = 0
		const unsubscribeCommit = state.silo.store.on.transactionCommit.subscribe(
			`count-adoption-commits`,
			() => commits++,
		)

		state.silo.runTransaction(updateTransaction)()
		await proposalObserved

		expect(proposed).toBeDefined()
		expect(commits).toBe(1)
		expect(state.silo.getState(state.countAtom)).toBe(1)
		acceptedRevision = 1
		acceptProposal({
			accepted: {
				batch: { ...proposed!, actor: `alice` },
				revision: acceptedRevision,
			},
			status: `accepted`,
		})
		await bridge.flush()
		expect(client.state).toMatchObject({ revision: 1, status: `live` })
		unsubscribeCommit()
	})

	test(`adopts a mixed value/signal transaction once and settles two clients`, async () => {
		const serverState = await fixture(`bridge-mixed-server`)
		const clientState = await fixture(`bridge-mixed-client`)
		const server = createMosaicDomainBatchServer({
			domain: serverState.domain,
		})
		const recorded = recordingTransport(
			server.connect({ actor: `alice`, session: `session-a` }),
		)
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: recorded.transport,
		})
		await client.start()
		const editTransaction = clientState.silo.transaction<() => void>({
			do: ({ set }) => {
				set(clientState.countAtom, 1)
				set(clientState.textAtom, (text) => {
					text.change(
						{ text: `hello`, type: `replace-text` },
						{
							actor: `alice`,
							dependencies: [],
							group: `gesture-a`,
							id: `text-operation-a`,
							now: 0,
							revision: null,
							session: `session-a`,
						},
					)
					return text
				})
			},
			key: `edit`,
		})
		const bridge = createMosaicDomainTransactionBridge({
			client,
			domain: clientState.domain,
			transactions: [editTransaction],
		})

		clientState.silo.runTransaction(editTransaction, `gesture-a`)()
		expect(clientState.silo.getState(clientState.countAtom)).toBe(1)
		expect(clientState.silo.getState(clientState.textAtom).text).toBe(`hello`)
		await bridge.flush()

		expect(recorded.proposals).toHaveLength(1)
		expect(recorded.proposals[0]?.operations).toHaveLength(2)
		expect(recorded.proposals[0]?.group).toBe(`gesture-a`)
		expect(clientState.silo.getState(clientState.countAtom)).toBe(1)
		expect(clientState.silo.getState(clientState.textAtom).text).toBe(`hello`)
		expect(serverState.silo.getState(serverState.countAtom)).toBe(1)
		expect(serverState.silo.getState(serverState.textAtom).text).toBe(`hello`)
		expect(client.state).toMatchObject({ revision: 1, status: `live` })
	})

	test(`aligns mutable-family snapshots with transceiver JSON projections`, async () => {
		const serverState = await textFamilyFixture(`bridge-family-server`)
		const clientState = await textFamilyFixture(`bridge-family-client`)
		const server = createMosaicDomainBatchServer({ domain: serverState.domain })
		const recorded = recordingTransport(
			server.connect({ actor: `alice`, session: `session-a` }),
		)
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: recorded.transport,
		})
		await client.start()
		const editTransaction = clientState.silo.transaction<() => void>({
			do: ({ set }) => {
				set(clientState.textAtom, (text) => {
					text.change(
						{ text: `family`, type: `replace-text` },
						{
							actor: `alice`,
							dependencies: [],
							group: `gesture-family`,
							id: `text-family-operation`,
							now: 0,
							revision: null,
							session: `session-a`,
						},
					)
					return text
				})
			},
			key: `edit`,
		})
		const bridge = createMosaicDomainTransactionBridge({
			client,
			domain: clientState.domain,
			transactions: [editTransaction],
		})

		clientState.silo.runTransaction(editTransaction)()
		await bridge.flush()

		expect(recorded.proposals).toHaveLength(1)
		expect(recorded.proposals[0]?.affectedMembers).toEqual([
			clientState.domain.address(`text`, `chapter`),
		])
		expect(clientState.silo.getState(clientState.textAtom).text).toBe(`family`)
		expect(serverState.silo.getState(serverState.textAtom).text).toBe(`family`)
	})

	test(`preserves the outer boundary, ignores aborts, and survives observers`, async () => {
		const serverState = await fixture(`bridge-nested-server`)
		const clientState = await fixture(`bridge-nested-client`)
		const server = createMosaicDomainBatchServer({
			domain: serverState.domain,
		})
		const recorded = recordingTransport(
			server.connect({ actor: `alice`, session: `session-a` }),
		)
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: recorded.transport,
		})
		await client.start()
		const innerTransaction = clientState.silo.transaction<() => void>({
			do: ({ set }) => {
				set(clientState.countAtom, 1)
			},
			key: `inner`,
		})
		const failedInnerTransaction = clientState.silo.transaction<() => void>({
			do: ({ set }) => {
				set(clientState.countAtom, 99)
				throw new Error(`abort inner`)
			},
			key: `failedInner`,
		})
		const outerTransaction = clientState.silo.transaction<() => void>({
			do: ({ run, set }) => {
				try {
					run(failedInnerTransaction)()
				} catch {
					// The outer transaction deliberately survives the inner abort.
				}
				run(innerTransaction)()
				set(clientState.countAtom, 2)
			},
			key: `outer`,
		})
		const abortTransaction = clientState.silo.transaction<() => void>({
			do: ({ run }) => {
				run(innerTransaction)()
				throw new Error(`abort bridge`)
			},
			key: `abort`,
		})
		const bridge = createMosaicDomainTransactionBridge({
			client,
			domain: clientState.domain,
			transactions: [outerTransaction, abortTransaction],
		})
		const observerError = new Error(`observer after commit`)
		const unsubscribe = clientState.silo.subscribe(clientState.countAtom, () => {
			throw observerError
		})

		expect(() => {
			clientState.silo.runTransaction(outerTransaction)()
		}).toThrow(observerError)
		unsubscribe()
		expect(() => {
			clientState.silo.runTransaction(abortTransaction)()
		}).toThrow(`abort bridge`)
		await bridge.flush()

		expect(recorded.proposals).toHaveLength(1)
		expect(recorded.proposals[0]?.operations).toHaveLength(2)
		expect(clientState.silo.getState(clientState.countAtom)).toBe(2)
		expect(serverState.silo.getState(serverState.countAtom)).toBe(2)
	})

	test(`serializes rapid async schemas in commit order`, async () => {
		let releaseFirst!: () => void
		const first = new Promise<void>((resolve) => {
			releaseFirst = resolve
		})
		let blocked = true
		const schema = z
			.object({
				from: z.number(),
				to: z.number(),
				type: z.literal(`set`),
			})
			.transform(async (operation) => {
				if (operation.to === 1 && blocked) await first
				return operation
			})
		const model = registerModel(schema)
		const serverState = await fixture(`bridge-async-server`, model)
		const clientState = await fixture(`bridge-async-client`, model)
		const server = createMosaicDomainBatchServer({
			domain: serverState.domain,
		})
		const recorded = recordingTransport(
			server.connect({ actor: `alice`, session: `session-a` }),
		)
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: recorded.transport,
		})
		await client.start()
		const updateTransaction = clientState.silo.transaction<
			(value: number) => void
		>({
			do: ({ set }, value) => {
				set(clientState.countAtom, value)
			},
			key: `update`,
		})
		const bridge = createMosaicDomainTransactionBridge({
			client,
			domain: clientState.domain,
			transactions: [updateTransaction],
		})

		clientState.silo.runTransaction(updateTransaction)(1)
		clientState.silo.runTransaction(updateTransaction)(2)
		await Promise.resolve()
		expect(recorded.proposals).toHaveLength(0)
		expect(bridge.pendingCommitCount).toBe(2)
		blocked = false
		releaseFirst()
		await bridge.flush()

		expect(
			recorded.proposals.map(
				(batch) => (batch.operations[0]?.operation as { to: number }).to,
			),
		).toEqual([1, 2])
		expect(serverState.silo.getState(serverState.countAtom)).toBe(2)
		expect(clientState.silo.getState(clientState.countAtom)).toBe(2)
	})

	test(`retains no proposal for unrelated work and reprojects rejection`, async () => {
		const serverState = await fixture(`bridge-reject-server`)
		const clientState = await fixture(`bridge-reject-client`)
		const server = createMosaicDomainBatchServer({
			authorize: () => false,
			domain: serverState.domain,
		})
		const recorded = recordingTransport(
			server.connect({ actor: `alice`, session: `session-a` }),
		)
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: recorded.transport,
		})
		await client.start()
		const updateTransaction = clientState.silo.transaction<() => void>({
			do: ({ set }) => {
				set(clientState.countAtom, 9)
			},
			key: `update`,
		})
		const localTransaction = clientState.silo.transaction<() => void>({
			do: ({ set }) => {
				set(clientState.localAtom, 1)
			},
			key: `local`,
		})
		const bridge = createMosaicDomainTransactionBridge({
			client,
			domain: clientState.domain,
			transactions: [localTransaction, updateTransaction],
		})

		clientState.silo.runTransaction(localTransaction)()
		clientState.silo.runTransaction(updateTransaction)()
		expect(clientState.silo.getState(clientState.countAtom)).toBe(9)
		await bridge.flush()

		expect(recorded.proposals).toHaveLength(1)
		expect(clientState.silo.getState(clientState.countAtom)).toBe(0)
		expect(serverState.silo.getState(serverState.countAtom)).toBe(0)
	})

	test(`retains a failed commit and retries before later commits`, async () => {
		let accepts = false
		const schema = z
			.object({
				from: z.number(),
				to: z.number(),
				type: z.literal(`set`),
			})
			.refine(() => accepts, `encoder temporarily unavailable`)
		const model = registerModel(schema)
		const serverState = await fixture(`bridge-retry-server`, model)
		const clientState = await fixture(`bridge-retry-client`, model)
		const server = createMosaicDomainBatchServer({
			domain: serverState.domain,
		})
		const recorded = recordingTransport(
			server.connect({ actor: `alice`, session: `session-a` }),
		)
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: recorded.transport,
		})
		await client.start()
		const updateTransaction = clientState.silo.transaction<
			(value: number) => void
		>({
			do: ({ set }, value) => {
				set(clientState.countAtom, value)
			},
			key: `update`,
		})
		const bridge = createMosaicDomainTransactionBridge({
			client,
			domain: clientState.domain,
			transactions: [updateTransaction],
		})

		clientState.silo.runTransaction(updateTransaction)(5)
		await expect(bridge.flush()).rejects.toThrow(
			`encoder temporarily unavailable`,
		)
		expect(bridge.problem).toBeInstanceOf(Error)
		expect(clientState.silo.getState(clientState.countAtom)).toBe(5)
		expect(recorded.proposals).toHaveLength(0)
		clientState.silo.runTransaction(updateTransaction)(6)

		accepts = true
		await bridge.retry()
		await bridge.flush()

		expect(
			recorded.proposals.map(
				(batch) => (batch.operations[0]?.operation as { to: number }).to,
			),
		).toEqual([5, 6])
		expect(serverState.silo.getState(serverState.countAtom)).toBe(6)
		expect(clientState.silo.getState(clientState.countAtom)).toBe(6)
	})

	test(`bridges an ordinary durable atom whose key starts with a star`, async () => {
		const serverState = await fixture(
			`bridge-star-server`,
			registerModel(),
			new Silo({
				isProduction: false,
				lifespan: `ephemeral`,
				name: `bridge-star-server`,
			}),
			`*count`,
		)
		const clientState = await fixture(
			`bridge-star-client`,
			registerModel(),
			new Silo({
				isProduction: false,
				lifespan: `ephemeral`,
				name: `bridge-star-client`,
			}),
			`*count`,
		)
		const server = createMosaicDomainBatchServer({ domain: serverState.domain })
		const recorded = recordingTransport(
			server.connect({ actor: `alice`, session: `session-a` }),
		)
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: recorded.transport,
		})
		await client.start()
		const updateTransaction = clientState.silo.transaction<
			(callback: () => void) => () => void
		>({
			do: ({ set }, callback) => {
				set(clientState.countAtom, 7)
				return callback
			},
			key: `update`,
		})
		const bridge = createMosaicDomainTransactionBridge({
			client,
			domain: clientState.domain,
			transactions: [updateTransaction],
		})

		clientState.silo.runTransaction(updateTransaction)(() => undefined)
		await bridge.flush()

		expect(recorded.proposals).toHaveLength(1)
		expect(clientState.silo.getState(clientState.countAtom)).toBe(7)
		expect(serverState.silo.getState(serverState.countAtom)).toBe(7)
	})

	test(`fails closed for a durable member without a transaction encoder`, async () => {
		const model = registerModel()
		const state = await fixture(`bridge-missing-encoder`, {
			identity: model.identity,
			kind: model.kind,
			operationSchema: model.operationSchema,
			reduce: model.reduce,
		})
		const proposed = vitest.fn()
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: state.domain,
			session: `session-a`,
			transport: {
				propose: proposed,
				recover: () => Promise.resolve({ headRevision: 0, tail: [] }),
				subscribe: () => () => undefined,
			},
		})
		await client.start()
		const updateTransaction = state.silo.transaction<() => void>({
			do: ({ set }) => {
				set(state.countAtom, 1)
			},
			key: `update`,
		})
		const bridge = createMosaicDomainTransactionBridge({
			client,
			domain: state.domain,
			transactions: [updateTransaction],
		})

		state.silo.runTransaction(updateTransaction)()
		await expect(bridge.flush()).rejects.toThrow(`has no transaction encoder`)
		expect(state.silo.getState(state.countAtom)).toBe(1)
		expect(proposed).not.toHaveBeenCalled()
		expect(bridge.pendingCommitCount).toBe(1)
		await expect(bridge.retry()).rejects.toThrow(`has no transaction encoder`)

		bridge[Symbol.dispose]()
		expect(bridge.pendingCommitCount).toBe(0)
		expect(bridge.problem).toBeNull()
		bridge[Symbol.dispose]()
	})

	test(`fails closed for direct transceiver snapshots and mixed signal groups`, async () => {
		const state = await fixture(`bridge-transceiver-boundaries`)
		const proposed = vitest.fn()
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: state.domain,
			session: `session-a`,
			transport: {
				propose: proposed,
				recover: () => Promise.resolve({ headRevision: 0, tail: [] }),
				subscribe: () => () => undefined,
			},
		})
		await client.start()
		const snapshotTransaction = state.silo.transaction<() => void>({
			do: ({ json, set }) => {
				const replacement = new Text()
				replacement.change(
					{ text: `snapshot`, type: `replace-text` },
					{
						actor: `alice`,
						dependencies: [],
						group: `snapshot`,
						id: `snapshot-operation`,
						now: 0,
						revision: null,
						session: `session-a`,
					},
				)
				set(json(state.textAtom), replacement.toJSON())
			},
			key: `snapshot`,
		})
		const snapshotBridge = createMosaicDomainTransactionBridge({
			client,
			domain: state.domain,
			transactions: [snapshotTransaction],
		})

		state.silo.runTransaction(snapshotTransaction)()
		await expect(snapshotBridge.flush()).rejects.toThrow(
			`must change through model signals`,
		)
		expect(proposed).not.toHaveBeenCalled()
		snapshotBridge[Symbol.dispose]()

		const mixedGroupsTransaction = state.silo.transaction<() => void>({
			do: ({ set }) => {
				set(state.textAtom, (text) => {
					text.change(
						{ text: `first`, type: `replace-text` },
						{
							actor: `alice`,
							dependencies: [],
							group: `group-a`,
							id: `group-a-operation`,
							now: 1,
							revision: null,
							session: `session-a`,
						},
					)
					text.change(
						{ text: `second`, type: `replace-text` },
						{
							actor: `alice`,
							dependencies: [],
							group: `group-b`,
							id: `group-b-operation`,
							now: 2,
							revision: null,
							session: `session-a`,
						},
					)
					return text
				})
			},
			key: `mixedGroups`,
		})
		const groupBridge = createMosaicDomainTransactionBridge({
			client,
			domain: state.domain,
			transactions: [mixedGroupsTransaction],
		})

		state.silo.runTransaction(mixedGroupsTransaction)()
		await expect(groupBridge.flush()).rejects.toThrow(
			`cannot combine different signal groups`,
		)
		expect(proposed).not.toHaveBeenCalled()
		groupBridge[Symbol.dispose]()
	})

	test(`settles a bridged transaction through a realtime-testing topology`, async () => {
		const acceptedEvent = `mos11-bridge:accepted`
		const proposeEvent = `mos11-bridge:propose`
		const recoverEvent = `mos11-bridge:recover`
		let serverStatePromise: ReturnType<typeof fixture> | undefined
		let batchServerPromise:
			| Promise<ReturnType<typeof createMosaicDomainBatchServer>>
			| undefined
		const scenario = headless({
			scenarioId: `mos11-transaction-bridge`,
			server: (tools) => {
				serverStatePromise ??= fixture(
					`bridge-harness-server`,
					undefined,
					tools.silo,
				)
				batchServerPromise ??= serverStatePromise.then((state) =>
					createMosaicDomainBatchServer({ domain: state.domain }),
				)
				const connection = batchServerPromise.then((server) =>
					server.connect({
						actor: tools.userKey,
						session: tools.sessionId,
					}),
				)
				let unsubscribe: () => void = () => undefined
				void connection.then((connected) => {
					unsubscribe = connected.subscribe((accepted) => {
						tools.socket.emit(acceptedEvent, accepted)
					})
				})
				tools.socket.on(proposeEvent, (batch, respond) => {
					void tools.work
						.track(
							connection.then((connected) => connected.propose(batch)),
							`propose bridged Domain batch`,
						)
						.then(respond)
				})
				tools.socket.on(recoverEvent, (revision, respond) => {
					void tools.work
						.track(
							connection.then((connected) => connected.recover(revision)),
							`recover bridged Domain batches`,
						)
						.then(respond)
				})
				return () => {
					unsubscribe()
				}
			},
		})
		const aliceHarness = scenario.createClient({ name: `alice` })
		const bobHarness = scenario.createClient({ name: `bob` })
		try {
			await scenario.waitForIdle()
			const serverState = await serverStatePromise!
			const aliceState = await fixture(
				`bridge-harness-alice`,
				undefined,
				aliceHarness.silo,
			)
			const bobState = await fixture(
				`bridge-harness-bob`,
				undefined,
				bobHarness.silo,
			)
			const socketTransport = (
				harness: typeof aliceHarness,
			): MosaicDomainBatchClientTransport => ({
				propose(batch) {
					return new Promise((resolve) => {
						harness.socket.emit(proposeEvent, batch, resolve)
					})
				},
				recover(revision = 0) {
					return new Promise((resolve) => {
						harness.socket.emit(recoverEvent, revision, resolve)
					})
				},
				subscribe(listener) {
					harness.socket.on(acceptedEvent, listener)
					return () => harness.socket.off(acceptedEvent, listener)
				},
			})
			const alice = createMosaicDomainBatchClient({
				actor: aliceHarness.userKey,
				domain: aliceState.domain,
				session: aliceHarness.sessionId,
				transport: socketTransport(aliceHarness),
			})
			const bob = createMosaicDomainBatchClient({
				actor: bobHarness.userKey,
				domain: bobState.domain,
				session: bobHarness.sessionId,
				transport: socketTransport(bobHarness),
			})
			await Promise.all([alice.start(), bob.start()])
			const updateTransaction = aliceState.silo.transaction<() => void>({
				do: ({ set }) => {
					set(aliceState.countAtom, 42)
				},
				key: `update`,
			})
			const bridge = createMosaicDomainTransactionBridge({
				client: alice,
				domain: aliceState.domain,
				transactions: [updateTransaction],
			})

			aliceState.silo.runTransaction(updateTransaction)()
			await aliceHarness.work.track(bridge.flush(), `flush bridged transaction`)

			await expect(
				scenario.waitForConvergence({
					participants: [
						{
							label: `server`,
							read: () => serverState.silo.getState(serverState.countAtom),
						},
						{
							label: `alice`,
							read: () => aliceState.silo.getState(aliceState.countAtom),
						},
						{
							label: `bob`,
							read: () => bobState.silo.getState(bobState.countAtom),
						},
					],
				}),
			).resolves.toBe(42)
		} finally {
			await scenario.teardown()
		}
	})
})
