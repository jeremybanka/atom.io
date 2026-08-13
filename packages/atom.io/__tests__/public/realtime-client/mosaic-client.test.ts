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
import { createMosaicClient, type MosaicClient } from "atom.io/realtime-client"
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
})
