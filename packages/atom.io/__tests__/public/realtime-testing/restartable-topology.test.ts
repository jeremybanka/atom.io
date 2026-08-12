import {
	createImmediateReplicationAdapter,
	createRealtimeTestTopology,
	createRestartableServerFixture,
	type RealtimeTestTopologyNode,
} from "atom.io/realtime-testing"
import { describe, expect, test } from "vitest"

type Operation = { delta: number; id: string }
type ClientMessage = { operation: Operation; type: `operation` }
type ServerMessage =
	| { id: string; type: `ack` }
	| { count: number; type: `snapshot` }

type DurableState = {
	count: number
	operationIds: Set<string>
}

type EphemeralState = {
	dropNextAck: boolean
	sessions: Set<string>
}

function createCounterServer(name: string) {
	return createRestartableServerFixture({
		createDurableState: (): DurableState => ({
			count: 0,
			operationIds: new Set(),
		}),
		createEphemeralState: (): EphemeralState => ({
			dropNextAck: false,
			sessions: new Set(),
		}),
		name,
		start: ({ durable, ephemeral }) =>
			({
				connect: (session, context) => {
					ephemeral.sessions.add(session.sessionId)
					context.send(session, { count: durable.count, type: `snapshot` })
				},
				disconnect: (session) => {
					ephemeral.sessions.delete(session.sessionId)
				},
				receive: async (session, message: ClientMessage, context) => {
					const { operation } = message
					if (!durable.operationIds.has(operation.id)) {
						durable.operationIds.add(operation.id)
						durable.count += operation.delta
						await context.replicate(operation)
					}
					if (ephemeral.dropNextAck) {
						ephemeral.dropNextAck = false
					} else {
						context.send(session, { id: operation.id, type: `ack` })
					}
				},
				receiveReplication: ({ message: operation }) => {
					if (durable.operationIds.has(operation.id)) return
					durable.operationIds.add(operation.id)
					durable.count += operation.delta
				},
			}) satisfies RealtimeTestTopologyNode<
				ClientMessage,
				ServerMessage,
				Operation
			>,
	})
}

describe(`restartable server fixtures`, () => {
	test(`preserve durable state, recreate ephemeral state, and permit idempotent resend`, async () => {
		const node = createCounterServer(`alpha`)
		await node.start()
		const firstEphemeral = node.getEphemeralState()
		const messages: ServerMessage[] = []
		const topology = createRealtimeTestTopology<
			ClientMessage,
			ServerMessage,
			Operation
		>({ nodes: { alpha: node } })
		topology.addClient(`alice`, { receive: (message) => messages.push(message) })

		const firstSession = await topology.connect(`alice`, `alpha`)
		firstEphemeral.dropNextAck = true
		await topology.send(`alice`, {
			operation: { delta: 1, id: `op-1` },
			type: `operation`,
		})
		expect(messages).toEqual([{ count: 0, type: `snapshot` }])

		await topology.crashNode(`alpha`)
		await topology.restartNode(`alpha`)
		const secondEphemeral = node.getEphemeralState()
		expect(secondEphemeral).not.toBe(firstEphemeral)
		expect(secondEphemeral.sessions).toEqual(new Set())

		const secondSession = await topology.connect(`alice`, `alpha`)
		expect(secondSession.sessionId).not.toBe(firstSession.sessionId)
		expect(messages.at(-1)).toEqual({ count: 1, type: `snapshot` })

		// The client never observed the first acknowledgement, so it resends.
		await topology.send(`alice`, {
			operation: { delta: 1, id: `op-1` },
			type: `operation`,
		})
		expect(messages.at(-1)).toEqual({ id: `op-1`, type: `ack` })
		expect((await node.getDurableState()).count).toBe(1)
	})

	test(`can explicitly discard durable state during restart`, async () => {
		const node = createCounterServer(`alpha`)
		await node.start()
		const original = await node.getDurableState()
		original.count = 8

		await node.restart({ durability: `discard` })

		expect(await node.getDurableState()).not.toBe(original)
		expect((await node.getDurableState()).count).toBe(0)
	})

	test(`distinguishes graceful cleanup from a crash and rejects concurrent starts`, async () => {
		const lifecycle: string[] = []
		const node = createRestartableServerFixture({
			crash: () => {
				lifecycle.push(`crash`)
			},
			createDurableState: () => undefined,
			createEphemeralState: () => undefined,
			name: `lifecycle`,
			start: () => ({ generation: lifecycle.push(`start`) }),
			stop: () => {
				lifecycle.push(`stop`)
			},
		})

		const starting = node.start()
		await expect(node.start()).rejects.toThrow(`already running`)
		await starting
		await node.restart({ mode: `crash` })
		await node.stop()

		expect(lifecycle).toEqual([`start`, `crash`, `start`, `stop`])
	})
})

describe(`multi-node realtime test topologies`, () => {
	test(`stops a node after every client is detached even when hooks fail`, async () => {
		const detached: string[] = []
		let stopped = false
		const node = createRestartableServerFixture({
			createDurableState: () => undefined,
			createEphemeralState: () => undefined,
			name: `fallible`,
			start: () =>
				({
					disconnect: (session) => {
						detached.push(`server:${session.clientId}`)
						if (session.clientId === `alice`) throw new Error(`hook failed`)
					},
					receive: () => {},
				}) satisfies RealtimeTestTopologyNode<unknown, unknown, unknown>,
			stop: () => {
				stopped = true
			},
		})
		await node.start()
		const topology = createRealtimeTestTopology({ nodes: { fallible: node } })
		for (const clientId of [`alice`, `bob`]) {
			topology.addClient(clientId, {
				disconnected: () => detached.push(`client:${clientId}`),
				receive: () => {},
			})
			await topology.connect(clientId, `fallible`)
		}

		await expect(topology.stopNode(`fallible`)).rejects.toThrow(
			`Failed to stop topology node`,
		)

		expect(stopped).toBe(true)
		expect(node.running).toBe(false)
		expect(detached).toEqual([
			`server:alice`,
			`client:alice`,
			`server:bob`,
			`client:bob`,
		])
		expect(topology.getState().routes).toEqual([])
		expect(topology.getEvents().map(({ type }) => type)).toEqual([
			`client-connected`,
			`client-connected`,
			`client-disconnected`,
			`client-disconnected`,
			`node-stopped`,
		])
	})

	test(`keeps the previous route when a migration target rejects connection`, async () => {
		const alpha = createCounterServer(`alpha`)
		const rejecting = createRestartableServerFixture({
			createDurableState: () => undefined,
			createEphemeralState: () => undefined,
			name: `rejecting`,
			start: () =>
				({
					connect: () => {
						throw new Error(`connection rejected`)
					},
					receive: () => {},
				}) satisfies RealtimeTestTopologyNode<
					ClientMessage,
					ServerMessage,
					Operation
				>,
		})
		await Promise.all([alpha.start(), rejecting.start()])
		const disconnected: string[] = []
		const topology = createRealtimeTestTopology<
			ClientMessage,
			ServerMessage,
			Operation
		>({ nodes: { alpha, rejecting } })
		topology.addClient(`alice`, {
			disconnected: (reason) => disconnected.push(reason),
			receive: () => {},
		})
		const original = await topology.connect(`alice`, `alpha`)

		await expect(topology.migrate(`alice`, `rejecting`)).rejects.toThrow(
			`connection rejected`,
		)
		await rejecting.stop()
		await expect(topology.migrate(`alice`, `rejecting`)).rejects.toThrow(
			`not running`,
		)
		await topology.send(`alice`, {
			operation: { delta: 2, id: `after-failure` },
			type: `operation`,
		})

		expect(disconnected).toEqual([])
		expect(topology.getState().routes).toEqual([original])
		expect((await alpha.getDurableState()).count).toBe(2)
	})

	test(`routes, migrates, kills, partitions, and diagnoses split brain`, async () => {
		const alpha = createCounterServer(`alpha`)
		const beta = createCounterServer(`beta`)
		await Promise.all([alpha.start(), beta.start()])
		const topology = createRealtimeTestTopology<
			ClientMessage,
			ServerMessage,
			Operation
		>({
			nodes: { alpha, beta },
			replication: createImmediateReplicationAdapter(),
		})
		const aliceMessages: ServerMessage[] = []
		const bobMessages: ServerMessage[] = []
		topology.addClient(`alice`, {
			receive: (message) => aliceMessages.push(message),
		})
		topology.addClient(`bob`, {
			receive: (message) => bobMessages.push(message),
		})

		const initialAliceSession = await topology.connect(`alice`, `alpha`)
		await topology.connect(`bob`, `beta`)
		await topology.send(`alice`, {
			operation: { delta: 1, id: `shared` },
			type: `operation`,
		})
		expect((await beta.getDurableState()).count).toBe(1)

		const migratedSession = await topology.migrate(`alice`, `beta`)
		expect(migratedSession.sessionId).not.toBe(initialAliceSession.sessionId)
		expect(aliceMessages.at(-1)).toEqual({ count: 1, type: `snapshot` })

		topology.partitionNodes(`alpha`, `beta`)
		const circularMessage = {
			operation: { delta: 10, id: `beta-only` },
			type: `operation`,
		} as ClientMessage & { self?: unknown }
		circularMessage.self = circularMessage
		await topology.send(`alice`, circularMessage)
		await topology.migrate(`bob`, `alpha`)
		await topology.send(`bob`, {
			operation: { delta: 100, id: `alpha-only` },
			type: `operation`,
		})

		expect((await alpha.getDurableState()).count).toBe(101)
		expect((await beta.getDurableState()).count).toBe(11)
		const splitBrainDiagnostics = topology.formatEvents()
		expect(splitBrainDiagnostics).toContain(`replication-blocked`)
		expect(splitBrainDiagnostics).toContain(`beta-only`)
		expect(splitBrainDiagnostics).toContain(`"message"`)
		expect(splitBrainDiagnostics).toContain(`"envelope"`)
		expect(splitBrainDiagnostics).toContain(`[Circular]`)
		expect(splitBrainDiagnostics).toContain(`"partitions"`)
		expect(splitBrainDiagnostics).toContain(`"generation":1`)
		expect(topology.getState().partitions).toEqual([
			{ left: `alpha`, right: `beta` },
		])

		topology.healNodes(`alpha`, `beta`)
		await topology.crashNode(`alpha`)
		const reconnected = await topology.connect(`bob`, `beta`)
		expect(reconnected.sessionId).toBe(`bob:3`)
		expect(bobMessages.at(-1)).toEqual({ count: 11, type: `snapshot` })
		expect(topology.getEvents().map(({ type }) => type)).toContain(
			`node-crashed`,
		)
	})
})
