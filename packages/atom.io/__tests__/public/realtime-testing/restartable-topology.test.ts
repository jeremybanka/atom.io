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

	test(`recovers from failed lifecycle hooks and preserves truthful state`, async () => {
		const events: string[] = []
		const node = createRestartableServerFixture({
			crash: () => {
				throw new Error(`crash hook failed`)
			},
			createDurableState: () => ({ value: 0 }),
			createEphemeralState: ({ generation }) => ({ generation }),
			name: `fallible-lifecycle`,
			onEvent: (event) => events.push(event.type),
			start: ({ generation }) => {
				if (generation === 1) throw new Error(`start hook failed`)
				return { generation }
			},
			stop: () => {
				throw new Error(`stop hook failed`)
			},
		})

		expect(() => node.getRuntime()).toThrow(`is not running`)
		expect(() => node.getEphemeralState()).toThrow(`is not running`)
		await expect(node.stop()).rejects.toThrow(`is not running`)
		await expect(node.crash()).rejects.toThrow(`is not running`)
		await expect(node.start()).rejects.toThrow(`start hook failed`)
		expect(node.running).toBe(false)
		expect(node.generation).toBe(1)

		await expect(node.start()).resolves.toEqual({ generation: 2 })
		await expect(node.discardDurableState()).rejects.toThrow(
			`Cannot discard durable state while server fixture`,
		)
		await expect(node.stop()).rejects.toThrow(`stop hook failed`)
		expect(node.running).toBe(false)
		expect(() => node.getRuntime()).toThrow(`is not running`)

		await node.start()
		await expect(node.crash()).rejects.toThrow(`crash hook failed`)
		expect(node.running).toBe(false)
		await node.discardDurableState()
		expect(events).toEqual([
			`started`,
			`stopped`,
			`started`,
			`crashed`,
			`durable-discarded`,
		])
	})
})

describe(`multi-node realtime test topologies`, () => {
	test(`validates clients, routes, and idempotent disconnects`, async () => {
		const alpha = createCounterServer(`alpha`)
		const beta = createCounterServer(`beta`)
		await Promise.all([alpha.start(), beta.start()])
		const observedEvents: string[] = []
		const topology = createRealtimeTestTopology({
			nodes: { alpha, beta },
			onEvent: (event) => observedEvents.push(event.type),
		})

		expect(topology.formatEvents()).toContain(`state`)
		topology.addClient(`alice`, { receive: () => {} })
		expect(() => {
			topology.addClient(`alice`, { receive: () => {} })
		}).toThrow(`already exists`)
		await expect(topology.connect(`unknown`, `alpha`)).rejects.toThrow(
			`Unknown topology client`,
		)
		await expect(topology.connect(`alice`, `missing`)).rejects.toThrow(
			`Unknown topology node`,
		)

		await topology.connect(`alice`, `alpha`)
		await expect(topology.connect(`alice`, `alpha`)).rejects.toThrow(
			`already connected`,
		)
		await topology.disconnect(`alice`)
		await topology.disconnect(`alice`)
		await expect(
			topology.send(`alice`, {
				operation: { delta: 1, id: `disconnected` },
				type: `operation`,
			}),
		).rejects.toThrow(`is not connected`)

		const reconnected = await topology.migrate(`alice`, `alpha`)
		expect(reconnected.sessionId).toBe(`alice:2`)
		topology.partitionNodes(`alpha`, `beta`)
		expect(topology.getState().partitions).toEqual([
			{ left: `alpha`, right: `beta` },
		])
		topology.healAll()
		expect(topology.getState().partitions).toEqual([])
		expect(observedEvents).toEqual(topology.getEvents().map(({ type }) => type))
	})

	test(`keeps diagnostics bounded and serializable for arbitrary payloads`, async () => {
		const node = createRestartableServerFixture({
			createDurableState: () => undefined,
			createEphemeralState: () => undefined,
			name: `diagnostics`,
			start: () => ({ receive: () => {} }),
		})
		await node.start()
		const topology = createRealtimeTestTopology<unknown, never, never>({
			nodes: { diagnostics: node },
		})
		topology.addClient(`alice`, { receive: () => {} })
		await topology.connect(`alice`, `diagnostics`)

		const unreadableObject = new Proxy(
			{},
			{
				ownKeys: () => {
					throw new Error(`ownKeys failed`)
				},
			},
		)
		const unreadableProperty = Object.defineProperty({}, `bad`, {
			enumerable: true,
			get: () => {
				throw new Error(`getter failed`)
			},
		})
		const wide = Object.fromEntries(
			Array.from({ length: 101 }, (_, index) => [`key-${index}`, index]),
		)
		let deep: Record<string, unknown> = {}
		for (let depth = 0; depth < 9; depth++) deep = { child: deep }
		const unnamed = Object.defineProperty(() => {}, `name`, { value: `` })

		await topology.send(`alice`, {
			array: Array.from({ length: 101 }, (_, index) => index),
			bigint: 10n,
			date: new Date(`2026-01-02T03:04:05.000Z`),
			deep,
			error: new TypeError(`diagnostic failure`),
			namedFunction: function namedDiagnostic() {},
			symbol: Symbol(`diagnostic`),
			undefined,
			unnamed,
			unreadableObject,
			unreadableProperty,
			wide,
			long: `x`.repeat(4_097),
		})

		const event = topology
			.getEvents()
			.find(({ type }) => type === `client-message`)
		expect(event).toBeDefined()
		const diagnostic = JSON.stringify(event?.details[`message`])
		expect(diagnostic).toContain(`…[truncated]`)
		expect(diagnostic).toContain(`[Depth limit]`)
		expect(diagnostic).toContain(`[Function namedDiagnostic]`)
		expect(diagnostic).toContain(`[Function anonymous]`)
		expect(diagnostic).toContain(`[undefined]`)
		expect(diagnostic).toContain(`10n`)
		expect(diagnostic).toContain(`Symbol(diagnostic)`)
		expect(diagnostic).toContain(`2026-01-02T03:04:05.000Z`)
		expect(diagnostic).toContain(`diagnostic failure`)
		expect(diagnostic).toContain(`[Unreadable object: Error: ownKeys failed]`)
		expect(diagnostic).toContain(`[Unreadable property: Error: getter failed]`)
		expect(diagnostic).toContain(`"[truncated]":true`)
	})

	test(`commits a migration while surfacing source cleanup failure`, async () => {
		const alpha = createRestartableServerFixture({
			createDurableState: () => undefined,
			createEphemeralState: () => undefined,
			name: `alpha`,
			start: () => ({
				disconnect: () => {
					throw new Error(`source disconnect failed`)
				},
				receive: () => {},
			}),
			stop: () => {
				throw new Error(`source stop failed`)
			},
		})
		const beta = createRestartableServerFixture({
			createDurableState: () => undefined,
			createEphemeralState: () => undefined,
			name: `beta`,
			start: () =>
				({
					connect: (session, context) => {
						context.send(session, `ready`)
					},
					receive: () => {},
				}) satisfies RealtimeTestTopologyNode<unknown, string, never>,
		})
		const rejecting = createRestartableServerFixture({
			createDurableState: () => undefined,
			createEphemeralState: () => undefined,
			name: `rejecting`,
			start: () => ({
				connect: () => {
					throw new Error(`target connect failed`)
				},
				disconnect: () => {
					throw new Error(`target cleanup failed`)
				},
				receive: () => {},
			}),
		})
		await Promise.all([alpha.start(), beta.start(), rejecting.start()])
		const received: string[] = []
		const topology = createRealtimeTestTopology<unknown, string, never>({
			nodes: { alpha, beta, rejecting },
		})
		topology.addClient(`alice`, {
			receive: (message) => received.push(message),
		})
		topology.addClient(`bob`, { receive: () => {} })
		await topology.connect(`alice`, `alpha`)

		await expect(topology.migrate(`alice`, `beta`)).rejects.toThrow(
			`failed to cleanly disconnect its previous route`,
		)
		expect(topology.getState().routes).toEqual([
			{ clientId: `alice`, nodeId: `beta`, sessionId: `alice:2` },
		])
		expect(received).toEqual([`ready`])

		await expect(topology.migrate(`alice`, `rejecting`)).rejects.toThrow(
			`Migration of "alice" to "rejecting" failed`,
		)
		await expect(topology.connect(`bob`, `rejecting`)).rejects.toThrow(
			`target connect failed`,
		)
		expect(topology.getState().routes).toHaveLength(1)

		await expect(topology.stopNode(`alpha`)).rejects.toThrow(
			`Failed to stop topology node`,
		)
		expect(alpha.running).toBe(false)
		expect(topology.getEvents().at(-1)?.type).toBe(`node-stopped`)
	})

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

	test(`restarts after every client is detached even when a disconnect hook fails`, async () => {
		const node = createRestartableServerFixture({
			createDurableState: () => undefined,
			createEphemeralState: () => undefined,
			name: `restartable`,
			start: () =>
				({
					disconnect: (session) => {
						if (session.clientId === `alice`) throw new Error(`hook failed`)
					},
					receive: () => {},
				}) satisfies RealtimeTestTopologyNode<unknown, unknown, unknown>,
		})
		await node.start()
		const topology = createRealtimeTestTopology({ nodes: { restartable: node } })
		for (const clientId of [`alice`, `bob`]) {
			topology.addClient(clientId, { receive: () => {} })
			await topology.connect(clientId, `restartable`)
		}

		await expect(topology.restartNode(`restartable`)).rejects.toThrow(
			`Failed to restart topology node`,
		)

		expect(node.running).toBe(true)
		expect(node.generation).toBe(2)
		expect(topology.getState().routes).toEqual([])
		expect(topology.getEvents().at(-1)?.type).toBe(`node-restarted`)
	})

	test(`crashes after every client is detached even when a callback fails`, async () => {
		const node = createCounterServer(`crashable`)
		await node.start()
		const notifications: string[] = []
		const topology = createRealtimeTestTopology({ nodes: { crashable: node } })
		for (const clientId of [`alice`, `bob`]) {
			topology.addClient(clientId, {
				disconnected: () => {
					notifications.push(clientId)
					if (clientId === `alice`) throw new Error(`callback failed`)
				},
				receive: () => {},
			})
			await topology.connect(clientId, `crashable`)
		}

		await expect(topology.crashNode(`crashable`)).rejects.toThrow(
			`Failed to crash topology node`,
		)

		expect(node.running).toBe(false)
		expect(notifications).toEqual([`alice`, `bob`])
		expect(topology.getState().routes).toEqual([])
		expect(topology.getEvents().at(-1)?.type).toBe(`node-crashed`)
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
