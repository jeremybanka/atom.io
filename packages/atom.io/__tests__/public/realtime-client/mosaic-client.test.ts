import type { Json } from "atom.io/foundations/json"
import {
	defineMosaicModel,
	defineMosaicResource,
	MOSAIC_EVENTS,
	MOSAIC_PROTOCOL_VERSION,
	type MosaicAcceptedOperationEnvelope,
	type MosaicJoinEnvelope,
	type MosaicOperationEnvelope,
	type MosaicOperationProposal,
	type MosaicPresenceEnvelope,
	type MosaicPresenceProposal,
	type MosaicReduceContext,
	type MosaicRejectionEnvelope,
	type MosaicSnapshotEnvelope,
	type Socket,
} from "atom.io/realtime"
import {
	createMosaicClient,
	type MosaicClient,
	type MosaicClientTransport,
} from "atom.io/realtime-client"
import { DeterministicTransport } from "atom.io/realtime-testing"

type TestIntent =
	| { readonly mode: `redo` | `undo`; readonly type: `history` }
	| { readonly type: `insert`; readonly value: string }

type TestOperation = TestIntent
type TestState = Readonly<Record<string, string>>

const testModel = defineMosaicModel<
	TestState,
	TestIntent,
	TestOperation,
	Record<string, string>
>({
	apply: (state, operation, context) =>
		operation.type === `insert`
			? { ...state, [context.id]: operation.value }
			: state,
	create: () => ({}),
	hydrate: (snapshot) => {
		if (typeof snapshot !== `object` || snapshot === null) {
			throw new Error(`Invalid test snapshot`)
		}
		return snapshot as Record<string, string>
	},
	key: `test.sequence`,
	prepare: (_state, intent) => intent,
	snapshot: (state) => state,
	validate: (_state, operation) =>
		typeof operation === `object` &&
		operation !== null &&
		`type` in operation &&
		(operation.type === `insert` || operation.type === `history`)
			? { operation: operation as TestOperation, status: `accept` }
			: { reason: `Invalid test operation`, status: `reject` },
	version: 1,
})

const testResource = defineMosaicResource({
	key: `documents/client-engine-test`,
	model: testModel,
})

type TestPresence = { readonly cursor: number }

const values = (state: TestState): string[] =>
	Object.entries(state)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([, value]) => value)

class ControlledTransport implements MosaicClientTransport {
	public connected: boolean
	public readonly outgoing: Array<{
		args: readonly Json.Serializable[]
		event: string
	}> = []
	readonly #listeners = new Map<
		string,
		Set<(...args: Json.Serializable[]) => void>
	>()

	public constructor(connected = false) {
		this.connected = connected
	}

	public emit(event: string, ...args: Json.Serializable[]): void {
		this.outgoing.push({ args: structuredClone(args), event })
	}

	public off(
		event: string,
		listener?: (...args: Json.Serializable[]) => void,
	): void {
		if (listener === undefined) this.#listeners.delete(event)
		else this.#listeners.get(event)?.delete(listener)
	}

	public on(
		event: string,
		listener: (...args: Json.Serializable[]) => void,
	): void {
		const listeners = this.#listeners.get(event) ?? new Set()
		listeners.add(listener)
		this.#listeners.set(event, listeners)
	}

	public receive(event: string, ...args: Json.Serializable[]): void {
		if (event === `connect`) this.connected = true
		if (event === `disconnect`) this.connected = false
		for (const listener of [...(this.#listeners.get(event) ?? [])]) {
			listener(...structuredClone(args))
		}
	}

	public sent(event: string): Json.Serializable[] {
		return this.outgoing
			.filter((entry) => entry.event === event)
			.map((entry) => entry.args[0])
	}
}

const controlledClient = (
	options: {
		actor?: string
		history?: boolean
		idSource?: () => string
		session?: string
		transport?: ControlledTransport
	} = {},
) =>
	createMosaicClient<
		typeof testModel,
		TestPresence,
		{ canTravel: boolean } | null
	>({
		actor: options.actor ?? `alice`,
		clock: { now: () => 1_000 },
		...(options.history === false
			? {}
			: {
					history: {
						intent: (mode) => ({ mode, type: `history` }),
						read: (state) => ({ canTravel: Object.keys(state).length > 0 }),
					},
				}),
		...(options.idSource === undefined ? {} : { idSource: options.idSource }),
		resource: testResource,
		session: options.session ?? `alice-session`,
		...(options.transport === undefined ? {} : { transport: options.transport }),
	})

const controlledSnapshot = (
	session = `alice-session`,
	overrides: Partial<MosaicSnapshotEnvelope<Record<string, string>>> = {},
): MosaicSnapshotEnvelope<Record<string, string>> => ({
	acceptedPendingOperationIds: [],
	model: { key: testModel.key, version: testModel.version },
	protocolVersion: MOSAIC_PROTOCOL_VERSION,
	resource: testResource.key,
	revision: 0,
	session,
	snapshot: {},
	...overrides,
})

const controlledAccepted = (
	proposal: MosaicOperationProposal<TestOperation>,
	overrides: Partial<MosaicAcceptedOperationEnvelope<TestOperation>> = {},
): MosaicAcceptedOperationEnvelope<TestOperation> => ({
	operation: { ...proposal, actor: `alice` },
	revision: 1,
	...overrides,
})

const controlledRejection = (
	overrides: Partial<MosaicRejectionEnvelope> = {},
): MosaicRejectionEnvelope => ({
	code: `invalid-model-operation`,
	operationId: null,
	protocolVersion: MOSAIC_PROTOCOL_VERSION,
	reason: `Rejected for testing.`,
	recovery: `none`,
	resource: testResource.key,
	session: `alice-session`,
	...overrides,
})

class TestMosaicPeer {
	readonly #accepted = new Map<
		string,
		MosaicAcceptedOperationEnvelope<TestOperation>
	>()
	readonly #connections: {
		actor: string
		socket: Socket
	}[] = []
	#rejectHistory = false
	#revision = 0
	#state: TestState = testModel.create()

	public add(socket: Socket, actor: string): void {
		this.#connections.push({ actor, socket })
		socket.on(MOSAIC_EVENTS.join, (value) => {
			this.#join(socket, value as MosaicJoinEnvelope)
		})
		socket.on(MOSAIC_EVENTS.operation, (value) => {
			this.#operation(
				socket,
				actor,
				value as MosaicOperationProposal<TestOperation>,
			)
		})
		socket.on(MOSAIC_EVENTS.presence, (value) => {
			const envelope = value as MosaicPresenceProposal<TestPresence | null>
			this.#broadcastPresence({ ...envelope, actor })
		})
	}

	public rejectHistory(value: boolean): void {
		this.#rejectHistory = value
	}

	#broadcastPresence(
		envelope: MosaicPresenceEnvelope<TestPresence | null>,
	): void {
		for (const connection of this.#connections) {
			connection.socket.emit(MOSAIC_EVENTS.presence, envelope)
		}
	}

	#join(socket: Socket, request: MosaicJoinEnvelope): void {
		if (
			request.protocolVersion !== MOSAIC_PROTOCOL_VERSION ||
			request.resource !== testResource.key
		) {
			const rejection: MosaicRejectionEnvelope = {
				code: `resource-unavailable`,
				operationId: null,
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				reason: `Cannot join this resource.`,
				recovery: `none`,
				resource: request.resource,
				session: request.session,
			}
			socket.emit(MOSAIC_EVENTS.rejection, rejection)
			return
		}
		const snapshot: MosaicSnapshotEnvelope<Record<string, string>> = {
			acceptedPendingOperationIds: request.pendingOperationIds.filter((id) =>
				this.#accepted.has(id),
			),
			model: { key: testModel.key, version: testModel.version },
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			resource: testResource.key,
			revision: this.#revision,
			session: request.session,
			snapshot: testModel.snapshot(this.#state),
		}
		socket.emit(MOSAIC_EVENTS.snapshot, snapshot)
	}

	#operation(
		socket: Socket,
		actor: string,
		envelope: MosaicOperationProposal<TestOperation>,
	): void {
		const duplicate = this.#accepted.get(envelope.id)
		if (duplicate !== undefined) {
			socket.emit(MOSAIC_EVENTS.operation, duplicate)
			return
		}
		if (this.#rejectHistory && envelope.operation.type === `history`) {
			const rejection: MosaicRejectionEnvelope = {
				code: `stale-history`,
				operationId: envelope.id,
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				reason: `The actor's history cursor moved.`,
				recovery: `resnapshot`,
				resource: testResource.key,
				session: envelope.session,
			}
			socket.emit(MOSAIC_EVENTS.rejection, rejection)
			return
		}
		const authenticated = { ...envelope, actor }
		const context: MosaicReduceContext = {
			actor,
			dependencies: envelope.dependencies,
			group: envelope.group,
			id: envelope.id,
			revision: this.#revision + 1,
			session: envelope.session,
		}
		const decision = testModel.validate(
			this.#state,
			authenticated.operation,
			context,
		)
		if (decision.status !== `accept`) throw new Error(`Unexpected test decision`)
		const operation = { ...authenticated, operation: decision.operation }
		this.#state = testModel.apply(this.#state, decision.operation, context)
		const accepted: MosaicAcceptedOperationEnvelope<TestOperation> = {
			operation,
			revision: ++this.#revision,
		}
		this.#accepted.set(envelope.id, accepted)
		for (const connection of this.#connections) {
			connection.socket.emit(MOSAIC_EVENTS.operation, accepted)
		}
	}
}

type ConnectedClient = {
	client: MosaicClient<typeof testModel, TestPresence, { canTravel: boolean }>
	clientSocket: Socket
	serverSocket: Socket
}

const createClient = (
	transport: DeterministicTransport,
	peer: TestMosaicPeer,
	actor: string,
): ConnectedClient => {
	const { left: clientSocket, right: serverSocket } = transport.createDuplex(
		{ id: actor, role: `client`, session: `${actor}-session` },
		{ id: `server-${actor}`, role: `server` },
	)
	peer.add(serverSocket, actor)
	let now = 1_000
	const client = createMosaicClient<
		typeof testModel,
		TestPresence,
		{
			canTravel: boolean
		}
	>({
		actor,
		clock: () => now++,
		history: {
			intent: (mode) => ({ mode, type: `history` }),
			read: (state) => ({ canTravel: Object.keys(state).length > 0 }),
		},
		resource: testResource,
		session: `${actor}-session`,
	})
	return { client, clientSocket, serverSocket }
}

describe(`Mosaic client`, () => {
	test(`rebases simultaneous offline edits and converges`, () => {
		const transport = new DeterministicTransport()
		const peer = new TestMosaicPeer()
		const alice = createClient(transport, peer, `alice`)
		const bob = createClient(transport, peer, `bob`)

		const aliceOperation = alice.client.submit({ type: `insert`, value: `A` })
		const bobOperation = bob.client.submit({ type: `insert`, value: `B` })
		expect(alice.client.read().status).toBe(`offline`)
		expect(bob.client.read().status).toBe(`offline`)
		expect(aliceOperation?.dependencies).toEqual([])
		expect(bobOperation?.dependencies).toEqual([])

		alice.client.connect(alice.clientSocket)
		bob.client.connect(bob.clientSocket)
		transport.runUntilIdle()

		expect(values(alice.client.read().state)).toEqual([`A`, `B`])
		expect(alice.client.read().state).toEqual(bob.client.read().state)
		expect(alice.client.read()).toMatchObject({
			pendingOperationIds: [],
			revision: 2,
			status: `live`,
		})
	})

	test(`resends a dropped acknowledgement with its original operation ID`, () => {
		const transport = new DeterministicTransport()
		const peer = new TestMosaicPeer()
		const alice = createClient(transport, peer, `alice`)
		alice.client.connect(alice.clientSocket)
		transport.runUntilIdle()
		const stopDropping = transport.use({
			effect: { type: `drop` },
			filter: {
				direction: `server-to-client`,
				event: MOSAIC_EVENTS.operation,
				to: `alice`,
			},
		})

		const operation = alice.client.submit({ type: `insert`, value: `once` })
		transport.runUntilIdle()
		expect(alice.client.read().pendingOperationIds).toEqual([operation?.id])
		stopDropping()
		alice.client.retryPending()
		transport.runUntilIdle()

		expect(values(alice.client.read().state)).toEqual([`once`])
		expect(alice.client.read()).toMatchObject({
			pendingOperationIds: [],
			revision: 1,
		})
	})

	test(`ignores duplicate delivery and recovers a reordered revision gap`, () => {
		const transport = new DeterministicTransport()
		const peer = new TestMosaicPeer()
		const writer = createClient(transport, peer, `writer`)
		const reader = createClient(transport, peer, `reader`)
		writer.client.connect(writer.clientSocket)
		reader.client.connect(reader.clientSocket)
		transport.runUntilIdle()
		transport.use({
			effect: { copies: 2, type: `duplicate` },
			filter: {
				direction: `server-to-client`,
				event: MOSAIC_EVENTS.operation,
				to: `writer`,
			},
		})
		transport.use({
			effect: { type: `reorder`, window: 2 },
			filter: {
				direction: `server-to-client`,
				event: MOSAIC_EVENTS.operation,
				to: `reader`,
			},
		})

		writer.client.submit({ type: `insert`, value: `one` })
		writer.client.submit({ type: `insert`, value: `two` })
		transport.runUntilIdle()

		expect(reader.client.read().state).toEqual(writer.client.read().state)
		expect(values(reader.client.read().state)).toEqual([`one`, `two`])
		expect(reader.client.read()).toMatchObject({ revision: 2, status: `live` })

		const staleSnapshot: MosaicSnapshotEnvelope<Record<string, string>> = {
			acceptedPendingOperationIds: [],
			model: { key: testModel.key, version: testModel.version },
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			resource: testResource.key,
			revision: 1,
			session: `reader-session`,
			snapshot: {},
		}
		reader.serverSocket.emit(MOSAIC_EVENTS.snapshot, staleSnapshot)
		transport.runUntilIdle()
		expect(values(reader.client.read().state)).toEqual([`one`, `two`])
		expect(reader.client.read().revision).toBe(2)

		reader.serverSocket.emit(MOSAIC_EVENTS.snapshot, {
			...staleSnapshot,
			revision: 999,
			session: `retired-reader-session`,
		})
		const retiredRejection: MosaicRejectionEnvelope = {
			code: `unauthorized`,
			operationId: null,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			reason: `Delayed response from a retired session.`,
			recovery: `none`,
			resource: testResource.key,
			session: `retired-reader-session`,
		}
		reader.serverSocket.emit(MOSAIC_EVENTS.rejection, retiredRejection)
		transport.runUntilIdle()
		expect(reader.client.read()).toMatchObject({
			problem: null,
			revision: 2,
			status: `live`,
		})
	})

	test(`quarantines stale history and recovers from an authoritative snapshot`, () => {
		const transport = new DeterministicTransport()
		const peer = new TestMosaicPeer()
		const alice = createClient(transport, peer, `alice`)
		alice.client.connect(alice.clientSocket)
		transport.runUntilIdle()
		alice.client.submit({ type: `insert`, value: `kept` })
		transport.runUntilIdle()
		expect(alice.client.read().history).toEqual({ canTravel: true })
		peer.rejectHistory(true)

		const history = alice.client.undo()
		transport.runUntilIdle()

		expect(values(alice.client.read().state)).toEqual([`kept`])
		expect(alice.client.read()).toMatchObject({
			pendingOperationIds: [],
			problem: {
				discarded: [{ id: history?.id }],
				kind: `rejection`,
				operationId: history?.id,
			},
			status: `live`,
		})
	})

	test(`publishes ephemeral presence and removes explicit departures`, () => {
		const transport = new DeterministicTransport()
		const peer = new TestMosaicPeer()
		const alice = createClient(transport, peer, `alice`)
		const bob = createClient(transport, peer, `bob`)
		alice.client.connect(alice.clientSocket)
		bob.client.connect(bob.clientSocket)
		transport.runUntilIdle()

		alice.client.publishPresence({ cursor: 4 })
		transport.runUntilIdle()
		expect(bob.client.read().presence).toMatchObject([
			{ actor: `alice`, presence: { cursor: 4 }, session: `alice-session` },
		])

		alice.client.dispose()
		transport.runUntilIdle()
		expect(bob.client.read().presence).toEqual([])
	})

	test(`assigns monotonic IDs and records causal dependencies`, () => {
		const transport = new DeterministicTransport()
		const peer = new TestMosaicPeer()
		const alice = createClient(transport, peer, `alice`)
		const first = alice.client.submit({ type: `insert`, value: `first` })
		const second = alice.client.submit({ type: `insert`, value: `second` })

		expect(first).not.toBeNull()
		expect(second).not.toBeNull()
		expect(first!.id < second!.id).toBe(true)
		expect(second?.dependencies).toEqual([first?.id])
		expect(alice.client.createGroupId()).toContain(`alice-session:group:`)
	})

	test(`validates identity, session, and unique generated IDs`, () => {
		expect(() => controlledClient({ actor: `` })).toThrow(
			`actor cannot be empty`,
		)
		expect(() => controlledClient({ session: `` })).toThrow(
			`session cannot be empty`,
		)

		let sequence = 0
		const generated = createMosaicClient<typeof testModel>({
			actor: `generated`,
			clock: () => 7,
			idSource: ({ kind }) =>
				kind === `session` ? `generated-session` : `generated-operation`,
			resource: testResource,
		})
		expect(generated.read().session).toBe(`generated-session`)
		expect(generated.submit({ type: `insert`, value: `first` })).not.toBeNull()
		expect(() =>
			generated.submit({ type: `insert`, value: String(sequence++) }),
		).toThrow(`was already issued`)
		expect(() =>
			controlledClient({ idSource: () => `` }).createGroupId(),
		).toThrow(`ID cannot be empty`)
		const defaults = createMosaicClient({
			actor: `defaults`,
			resource: testResource,
		})
		expect(defaults.read().session).toContain(`defaults:session:`)
	})

	test(`tracks subscriptions, explicit sync, replacement, disconnect, and disposal`, () => {
		const first = new ControlledTransport(false)
		const second = new ControlledTransport(false)
		const client = controlledClient({ transport: first })
		const snapshots: string[] = []
		const unsubscribe = client.subscribe(({ status }) => snapshots.push(status))

		client.synchronize()
		client.publishPresence({ cursor: 1 })
		expect(first.outgoing).toEqual([])
		first.receive(`connect`)
		expect(client.read().status).toBe(`syncing`)
		expect(first.sent(MOSAIC_EVENTS.join)).toHaveLength(1)
		first.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())
		client.synchronize()
		expect(first.sent(MOSAIC_EVENTS.join)).toHaveLength(2)
		first.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())
		client.publishPresence({ cursor: 2 })
		expect(client.read().presence).toHaveLength(1)
		expect(first.sent(MOSAIC_EVENTS.presence)).toHaveLength(1)

		client.connect(second)
		expect(client.read()).toMatchObject({ presence: [], status: `offline` })
		first.receive(`connect`)
		expect(first.sent(MOSAIC_EVENTS.join)).toHaveLength(2)
		second.receive(`connect`)
		second.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())
		client.publishPresence({ cursor: 3 })
		second.receive(`disconnect`)
		expect(client.read()).toMatchObject({ presence: [], status: `offline` })

		unsubscribe()
		const beforeDispose = snapshots.length
		client.dispose()
		client.dispose()
		second.receive(`connect`)
		expect(snapshots).toHaveLength(beforeDispose)
		expect(client.read().status).toBe(`offline`)
	})

	test(`supports unavailable history, no-op history, groups, and problem clearing`, () => {
		const transport = new ControlledTransport(true)
		const withoutHistory = controlledClient({ history: false, transport })
		transport.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())
		expect(withoutHistory.read().history).toBeNull()
		expect(withoutHistory.undo()).toBeNull()
		expect(withoutHistory.redo()).toBeNull()

		const noHistoryModel = defineMosaicModel({
			...testModel,
			key: `test.no-history`,
			prepare: (
				state: TestState,
				intent: TestIntent,
				context: Parameters<typeof testModel.prepare>[2],
			) =>
				intent.type === `history`
					? null
					: testModel.prepare(state, intent, context),
		})
		const noHistory = createMosaicClient({
			actor: `alice`,
			history: {
				intent: (mode) => ({ mode, type: `history` as const }),
				read: () => null,
			},
			resource: defineMosaicResource({
				key: `documents/no-history`,
				model: noHistoryModel,
			}),
			session: `alice-session`,
		})
		expect(noHistory.undo()).toBeNull()
		const nullIntent = createMosaicClient({
			actor: `alice`,
			history: { intent: () => null, read: () => null },
			resource: testResource,
			session: `null-history-session`,
		})
		expect(nullIntent.redo()).toBeNull()

		const online = new ControlledTransport(true)
		const client = controlledClient({ transport: online })
		online.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())
		const group = client.createGroupId()
		const operation = client.submit(
			{ type: `insert`, value: `grouped` },
			{ group },
		)
		expect(operation?.group).toBe(group)
		online.receive(MOSAIC_EVENTS.rejection, controlledRejection())
		expect(client.read().status).toBe(`rejected`)
		expect(client.submit({ type: `insert`, value: `blocked` })).toBeNull()
		client.clearProblem()
		expect(client.read().problem).toBeNull()
		client.clearProblem()
	})

	test(`recovers malformed, invalid, duplicate, foreign, and gapped operations`, () => {
		const transport = new ControlledTransport(true)
		const client = controlledClient({ transport })
		transport.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())
		const pending = client.submit({ type: `insert`, value: `pending` })!

		transport.receive(MOSAIC_EVENTS.operation, `malformed`)
		expect(client.read()).toMatchObject({
			pendingOperationIds: [],
			problem: { kind: `protocol` },
			status: `recovering`,
		})
		transport.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())
		client.clearProblem()

		transport.receive(
			MOSAIC_EVENTS.operation,
			controlledAccepted(pending, { revision: 0 }),
		)
		expect(client.read().status).toBe(`recovering`)
		transport.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())

		const foreign = controlledAccepted(pending, {
			operation: {
				...controlledAccepted(pending).operation,
				resource: `documents/foreign`,
			},
		})
		transport.receive(MOSAIC_EVENTS.operation, foreign)
		expect(client.read().revision).toBe(0)
		transport.receive(MOSAIC_EVENTS.operation, {
			...controlledAccepted(pending),
			operation: { ...controlledAccepted(pending).operation, actor: `` },
		})
		expect(client.read().revision).toBe(0)

		transport.receive(
			MOSAIC_EVENTS.operation,
			controlledAccepted(pending, { revision: 4 }),
		)
		expect(client.read().status).toBe(`recovering`)
		transport.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())

		const accepted = controlledAccepted(pending)
		transport.receive(MOSAIC_EVENTS.operation, accepted)
		expect(client.read().revision).toBe(1)
		transport.receive(MOSAIC_EVENTS.operation, { ...accepted, revision: 2 })
		expect(client.read()).toMatchObject({
			problem: { kind: `protocol` },
			status: `recovering`,
		})
		transport.receive(MOSAIC_EVENTS.operation, accepted)
		expect(client.read().revision).toBe(1)
	})

	test(`rejects malformed snapshots and hydration failures while ignoring stale and foreign ones`, () => {
		const transport = new ControlledTransport(true)
		const client = controlledClient({ transport })
		transport.receive(MOSAIC_EVENTS.snapshot, `malformed`)
		expect(client.read()).toMatchObject({
			problem: { kind: `protocol` },
			status: `rejected`,
		})

		const cases: Json.Serializable[] = [
			{ ...controlledSnapshot(), protocolVersion: 99 },
			{ ...controlledSnapshot(), model: null },
			{ ...controlledSnapshot(), acceptedPendingOperationIds: [1] },
			{ ...controlledSnapshot(), revision: -1 },
		]
		for (const malformed of cases) {
			const isolatedTransport = new ControlledTransport(true)
			const isolated = controlledClient({ transport: isolatedTransport })
			isolatedTransport.receive(MOSAIC_EVENTS.snapshot, malformed)
			expect(isolated.read().status).toBe(`rejected`)
		}

		const hydrateTransport = new ControlledTransport(true)
		const hydrateClient = controlledClient({ transport: hydrateTransport })
		hydrateTransport.receive(
			MOSAIC_EVENTS.snapshot,
			controlledSnapshot(`alice-session`, { snapshot: null as never }),
		)
		expect(hydrateClient.read().problem).toMatchObject({ kind: `protocol` })

		const validTransport = new ControlledTransport(true)
		const valid = controlledClient({ transport: validTransport })
		validTransport.receive(
			MOSAIC_EVENTS.snapshot,
			controlledSnapshot(`alice-session`, { revision: 2 }),
		)
		validTransport.receive(
			MOSAIC_EVENTS.snapshot,
			controlledSnapshot(`alice-session`, {
				revision: 1,
				snapshot: { stale: `x` },
			}),
		)
		validTransport.receive(
			MOSAIC_EVENTS.snapshot,
			controlledSnapshot(`retired-session`, { revision: 99 }),
		)
		expect(valid.read()).toMatchObject({ problem: null, revision: 2 })
	})

	test(`applies structured rejection recovery and quarantines dependent proposals`, () => {
		const retryTransport = new ControlledTransport(true)
		const retry = controlledClient({ transport: retryTransport })
		retryTransport.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())
		const first = retry.submit({ type: `insert`, value: `first` })!
		const second = retry.submit({ type: `insert`, value: `second` })!
		expect(second.dependencies).toEqual([first.id])
		const sentBefore = retryTransport.sent(MOSAIC_EVENTS.operation).length
		retryTransport.receive(
			MOSAIC_EVENTS.rejection,
			controlledRejection({
				code: `missing-dependency`,
				operationId: second.id,
				recovery: `retry`,
			}),
		)
		expect(retry.read()).toMatchObject({
			pendingOperationIds: [first.id, second.id],
			problem: { discarded: [], recovery: `retry` },
			status: `live`,
		})
		retry.retryPending()
		expect(retryTransport.sent(MOSAIC_EVENTS.operation).length).toBeGreaterThan(
			sentBefore,
		)
		retryTransport.receive(
			MOSAIC_EVENTS.rejection,
			controlledRejection({
				code: `resource-unavailable`,
				operationId: second.id,
				recovery: `resnapshot`,
			}),
		)
		expect(retry.read()).toMatchObject({
			pendingOperationIds: [first.id, second.id],
			status: `recovering`,
		})
		retryTransport.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())

		retryTransport.receive(
			MOSAIC_EVENTS.rejection,
			controlledRejection({
				operationId: first.id,
				recovery: `discard-operation`,
			}),
		)
		expect(retry.read()).toMatchObject({
			pendingOperationIds: [],
			problem: {
				discarded: [{ id: first.id }, { id: second.id }],
				recovery: `discard-operation`,
			},
			status: `live`,
		})

		const fatalTransport = new ControlledTransport(true)
		const fatal = controlledClient({ transport: fatalTransport })
		fatalTransport.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())
		const fatalOperation = fatal.submit({ type: `insert`, value: `fatal` })!
		fatalTransport.receive(
			MOSAIC_EVENTS.rejection,
			controlledRejection({
				code: `incompatible-version`,
				operationId: fatalOperation.id,
				recovery: `upgrade`,
			}),
		)
		expect(fatal.read()).toMatchObject({
			pendingOperationIds: [],
			status: `rejected`,
		})
	})

	test(`ignores unrelated rejection and validates malformed rejection fields`, () => {
		const transport = new ControlledTransport(true)
		const client = controlledClient({ transport })
		transport.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())
		const pending = client.submit({ type: `insert`, value: `pending` })!

		transport.receive(
			MOSAIC_EVENTS.rejection,
			controlledRejection({ operationId: `unknown-operation` }),
		)
		transport.receive(
			MOSAIC_EVENTS.rejection,
			controlledRejection({ resource: `documents/foreign` }),
		)
		transport.receive(
			MOSAIC_EVENTS.rejection,
			controlledRejection({ session: `retired-session` }),
		)
		expect(client.read()).toMatchObject({
			pendingOperationIds: [pending.id],
			problem: null,
		})

		const malformed: Json.Serializable[] = [
			`bad`,
			{ ...controlledRejection(), session: 1 },
			{ ...controlledRejection(), operationId: 1 },
			{ ...controlledRejection(), code: `invented` },
			{ ...controlledRejection(), reason: 1 },
			{ ...controlledRejection(), recovery: `invented` },
		]
		for (const value of malformed) {
			const isolatedTransport = new ControlledTransport(true)
			const isolated = controlledClient({ transport: isolatedTransport })
			isolatedTransport.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())
			isolatedTransport.receive(MOSAIC_EVENTS.rejection, value)
			expect(isolated.read()).toMatchObject({
				problem: { kind: `protocol` },
				status: `rejected`,
			})
		}
	})

	test(`filters malformed and foreign presence and sorts active sessions`, () => {
		const transport = new ControlledTransport(true)
		const client = controlledClient({ transport })
		transport.receive(MOSAIC_EVENTS.snapshot, controlledSnapshot())
		const malformed: Json.Serializable[] = [
			`bad`,
			{ presence: { cursor: 1 }, resource: `documents/foreign` },
			{
				actor: 1,
				presence: { cursor: 1 },
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				resource: testResource.key,
				session: `other`,
			},
		]
		for (const value of malformed) {
			transport.receive(MOSAIC_EVENTS.presence, value)
		}
		expect(client.read().presence).toEqual([])

		for (const envelope of [
			{
				actor: `zoe`,
				presence: { cursor: 3 },
				session: `two`,
			},
			{
				actor: `amy`,
				presence: { cursor: 1 },
				session: `one`,
			},
			{
				actor: `amy`,
				presence: { cursor: 2 },
				session: `zero`,
			},
		]) {
			transport.receive(MOSAIC_EVENTS.presence, {
				...envelope,
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				resource: testResource.key,
			})
		}
		expect(
			client.read().presence.map(({ actor, session }) => [actor, session]),
		).toEqual([
			[`amy`, `one`],
			[`amy`, `zero`],
			[`zoe`, `two`],
		])
		transport.receive(MOSAIC_EVENTS.presence, {
			actor: `amy`,
			presence: null,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			resource: testResource.key,
			session: `one`,
		})
		expect(client.read().presence).toHaveLength(2)
	})

	test(`fails closed when local, accepted, or rebased model application throws`, () => {
		const throwingModel = defineMosaicModel({
			...testModel,
			apply: (
				state: TestState,
				operation: TestOperation,
				context: MosaicReduceContext,
			) => {
				if (
					operation.type === `insert` &&
					(operation.value === `throw` || state[`break`] === `yes`)
				) {
					throw new Error(`model apply failed`)
				}
				return testModel.apply(state, operation, context)
			},
			key: `test.throwing`,
		})
		const throwingResource = defineMosaicResource({
			key: `documents/throwing`,
			model: throwingModel,
		})
		const transport = new ControlledTransport(true)
		const client = createMosaicClient({
			actor: `alice`,
			resource: throwingResource,
			session: `alice-session`,
			transport,
		})
		transport.receive(MOSAIC_EVENTS.snapshot, {
			...controlledSnapshot(),
			model: { key: throwingModel.key, version: throwingModel.version },
			resource: throwingResource.key,
		})
		expect(client.submit({ type: `insert`, value: `throw` })).toBeNull()
		expect(client.read()).toMatchObject({
			problem: { kind: `protocol` },
			status: `rejected`,
		})

		const acceptedTransport = new ControlledTransport(true)
		const acceptedClient = createMosaicClient({
			actor: `alice`,
			resource: throwingResource,
			session: `alice-session`,
			transport: acceptedTransport,
		})
		acceptedTransport.receive(MOSAIC_EVENTS.snapshot, {
			...controlledSnapshot(),
			model: { key: throwingModel.key, version: throwingModel.version },
			resource: throwingResource.key,
		})
		const proposal = acceptedClient.submit({ type: `insert`, value: `safe` })!
		acceptedTransport.receive(MOSAIC_EVENTS.operation, {
			operation: {
				...proposal,
				actor: `remote`,
				operation: { type: `insert`, value: `throw` },
			},
			revision: 1,
		})
		expect(acceptedClient.read()).toMatchObject({
			pendingOperationIds: [],
			problem: { kind: `protocol` },
			status: `recovering`,
		})

		const rebaseTransport = new ControlledTransport(true)
		const rebase = createMosaicClient({
			actor: `alice`,
			resource: throwingResource,
			session: `alice-session`,
			transport: rebaseTransport,
		})
		rebaseTransport.receive(MOSAIC_EVENTS.snapshot, {
			...controlledSnapshot(),
			model: { key: throwingModel.key, version: throwingModel.version },
			resource: throwingResource.key,
		})
		const rebasePending = rebase.submit({ type: `insert`, value: `safe` })!
		rebaseTransport.receive(MOSAIC_EVENTS.snapshot, {
			...controlledSnapshot(),
			model: { key: throwingModel.key, version: throwingModel.version },
			resource: throwingResource.key,
			revision: 1,
			snapshot: { break: `yes` },
		})
		expect(rebase.read()).toMatchObject({
			pendingOperationIds: [],
			problem: { discarded: [{ id: rebasePending.id }], kind: `protocol` },
			status: `recovering`,
		})
	})
})
