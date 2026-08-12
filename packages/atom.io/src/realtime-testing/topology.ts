import type {
	MaybePromise,
	RestartableServerController,
	RestartServerOptions,
} from "./restartable-server"

/** A logical socket session. Reconnecting always creates a new session ID. */
export type TopologyClientSession = {
	clientId: string
	nodeId: string
	sessionId: string
}

/** Why a topology client lost its route. */
export type TopologyDisconnectReason =
	| `client`
	| `migrate`
	| `node-crash`
	| `node-stop`

/** A replication envelope exchanged between server nodes. */
export type TopologyReplicationEnvelope<ReplicationMessage> = {
	from: string
	message: ReplicationMessage
	to: string
}

/** Context supplied whenever the topology invokes a server node. */
export type TopologyNodeContext<ServerMessage, ReplicationMessage> = {
	/** Replicate a message to all peers or to the selected nodes. */
	replicate: (
		message: ReplicationMessage,
		to?: readonly string[],
	) => Promise<void>
	/** Send a message to a connected client session. */
	send: (session: TopologyClientSession, message: ServerMessage) => void
}

/** Minimal interface a server runtime implements to participate in a topology. */
export type RealtimeTestTopologyNode<
	ClientMessage,
	ServerMessage,
	ReplicationMessage,
> = {
	connect?: (
		session: TopologyClientSession,
		context: TopologyNodeContext<ServerMessage, ReplicationMessage>,
	) => MaybePromise<void>
	disconnect?: (
		session: TopologyClientSession,
		reason: TopologyDisconnectReason,
		context: TopologyNodeContext<ServerMessage, ReplicationMessage>,
	) => MaybePromise<void>
	receive: (
		session: TopologyClientSession,
		message: ClientMessage,
		context: TopologyNodeContext<ServerMessage, ReplicationMessage>,
	) => MaybePromise<void>
	receiveReplication?: (
		envelope: TopologyReplicationEnvelope<ReplicationMessage>,
		context: TopologyNodeContext<ServerMessage, ReplicationMessage>,
	) => MaybePromise<void>
}

/** Adapter seam for shared streams, brokers, or deliberately partitioned logs. */
export type RealtimeTestReplicationAdapter<ReplicationMessage> = {
	deliver: (
		envelope: TopologyReplicationEnvelope<ReplicationMessage>,
		next: () => MaybePromise<void>,
	) => MaybePromise<void>
}

/** Immediately deliver replication envelopes when the topology permits them. */
export function createImmediateReplicationAdapter<
	ReplicationMessage,
>(): RealtimeTestReplicationAdapter<ReplicationMessage> {
	return { deliver: (_envelope, next) => next() }
}

/** Client callbacks used by {@link RealtimeTestTopology.addClient}. */
export type RealtimeTestTopologyClient<ServerMessage> = {
	disconnected?: (
		reason: TopologyDisconnectReason,
		session: TopologyClientSession,
	) => void
	receive: (message: ServerMessage, session: TopologyClientSession) => void
}

/** A structured diagnostic emitted by a realtime test topology. */
export type RealtimeTestTopologyEvent = {
	details: Readonly<Record<string, unknown>>
	sequence: number
	type:
		| `client-connected`
		| `client-disconnected`
		| `client-message`
		| `node-crashed`
		| `node-restarted`
		| `node-stopped`
		| `partition-created`
		| `partition-healed`
		| `replication-blocked`
		| `replication-delivered`
}

/** A point-in-time view of routes, nodes, and network partitions. */
export type RealtimeTestTopologyState = {
	nodes: Readonly<Record<string, { generation: number; running: boolean }>>
	partitions: readonly { left: string; right: string }[]
	routes: readonly TopologyClientSession[]
}

/** Options for {@link createRealtimeTestTopology}. */
export type RealtimeTestTopologyOptions<
	ClientMessage,
	ServerMessage,
	ReplicationMessage,
> = {
	nodes: Record<
		string,
		RestartableServerController<
			RealtimeTestTopologyNode<ClientMessage, ServerMessage, ReplicationMessage>
		>
	>
	onEvent?: (event: RealtimeTestTopologyEvent) => void
	replication?: RealtimeTestReplicationAdapter<ReplicationMessage>
}

type AnyServerFixture<ClientMessage, ServerMessage, ReplicationMessage> =
	RestartableServerController<
		RealtimeTestTopologyNode<ClientMessage, ServerMessage, ReplicationMessage>
	>

const DIAGNOSTIC_COLLECTION_LIMIT = 100
const DIAGNOSTIC_DEPTH_LIMIT = 8
const DIAGNOSTIC_STRING_LIMIT = 4_096

/** Snapshot an arbitrary protocol payload without retaining or traversing it forever. */
function toDiagnosticValue(
	value: unknown,
	seen: WeakSet<object> = new WeakSet(),
	depth = 0,
): unknown {
	if (typeof value === `string`) {
		if (value.length <= DIAGNOSTIC_STRING_LIMIT) return value
		return `${value.slice(0, DIAGNOSTIC_STRING_LIMIT)}…[truncated]`
	}
	if (
		value === null ||
		typeof value === `boolean` ||
		typeof value === `number`
	) {
		return value
	}
	if (typeof value === `bigint`) return `${value}n`
	if (typeof value === `symbol`) return String(value)
	if (typeof value === `function`)
		return `[Function ${value.name || `anonymous`}]`
	if (value === undefined) return `[undefined]`
	if (depth >= DIAGNOSTIC_DEPTH_LIMIT) return `[Depth limit]`
	if (seen.has(value)) return `[Circular]`
	seen.add(value)

	if (value instanceof Error) {
		return { message: value.message, name: value.name }
	}
	if (value instanceof Date) return value.toISOString()
	if (Array.isArray(value)) {
		const result = value
			.slice(0, DIAGNOSTIC_COLLECTION_LIMIT)
			.map((item) => toDiagnosticValue(item, seen, depth + 1))
		if (value.length > DIAGNOSTIC_COLLECTION_LIMIT) result.push(`[truncated]`)
		return result
	}

	const result: Record<string, unknown> = {}
	let keys: string[]
	try {
		keys = Object.keys(value)
	} catch (error) {
		return `[Unreadable object: ${String(error)}]`
	}
	for (const key of keys.slice(0, DIAGNOSTIC_COLLECTION_LIMIT)) {
		try {
			result[key] = toDiagnosticValue(
				(value as Record<string, unknown>)[key],
				seen,
				depth + 1,
			)
		} catch (error) {
			result[key] = `[Unreadable property: ${String(error)}]`
		}
	}
	if (keys.length > DIAGNOSTIC_COLLECTION_LIMIT) result[`[truncated]`] = true
	return result
}

/**
 * A controllable, transport-independent multi-node router for realtime tests.
 *
 * It owns logical client sessions and routing while applications retain their
 * own protocol, persistence, retry, acknowledgement, and merge semantics.
 */
export class RealtimeTestTopology<
	ClientMessage,
	ServerMessage,
	ReplicationMessage,
> {
	#clients = new Map<string, RealtimeTestTopologyClient<ServerMessage>>()
	#events: RealtimeTestTopologyEvent[] = []
	#nodes: Map<
		string,
		AnyServerFixture<ClientMessage, ServerMessage, ReplicationMessage>
	>
	#onEvent: ((event: RealtimeTestTopologyEvent) => void) | undefined
	#partitions = new Set<string>()
	#replication: RealtimeTestReplicationAdapter<ReplicationMessage>
	#routes = new Map<string, TopologyClientSession>()
	#sequence = 0
	#sessionCounters = new Map<string, number>()

	public constructor(
		options: RealtimeTestTopologyOptions<
			ClientMessage,
			ServerMessage,
			ReplicationMessage
		>,
	) {
		this.#nodes = new Map(Object.entries(options.nodes))
		this.#onEvent = options.onEvent
		this.#replication =
			options.replication ?? createImmediateReplicationAdapter()
	}

	/** Add a client endpoint. Client IDs must be unique. */
	public addClient(
		clientId: string,
		client: RealtimeTestTopologyClient<ServerMessage>,
	): void {
		if (this.#clients.has(clientId)) {
			throw new Error(`Topology client "${clientId}" already exists`)
		}
		this.#clients.set(clientId, client)
	}

	/** Connect a client to a running node and allocate a fresh socket session. */
	public async connect(
		clientId: string,
		nodeId: string,
	): Promise<TopologyClientSession> {
		this.#requireClient(clientId)
		this.#requireRuntime(nodeId)
		if (this.#routes.has(clientId)) {
			throw new Error(`Topology client "${clientId}" is already connected`)
		}

		const ordinal = (this.#sessionCounters.get(clientId) ?? 0) + 1
		const session = { clientId, nodeId, sessionId: `${clientId}:${ordinal}` }
		this.#routes.set(clientId, session)
		try {
			await this.#requireRuntime(nodeId).connect?.(
				session,
				this.#contextFor(nodeId),
			)
		} catch (error) {
			this.#routes.delete(clientId)
			throw error
		}
		this.#sessionCounters.set(clientId, ordinal)
		this.#emit(`client-connected`, session)
		return session
	}

	/** Disconnect a client from its current node. */
	public async disconnect(clientId: string): Promise<void> {
		await this.#disconnect(clientId, `client`, true)
	}

	/** Move a client to another node, producing a new socket session. */
	public async migrate(
		clientId: string,
		nodeId: string,
	): Promise<TopologyClientSession> {
		this.#requireClient(clientId)
		const target = this.#requireRuntime(nodeId)
		const previous = this.#routes.get(clientId)
		if (previous === undefined) return this.connect(clientId, nodeId)

		const ordinal = (this.#sessionCounters.get(clientId) ?? 0) + 1
		const session = { clientId, nodeId, sessionId: `${clientId}:${ordinal}` }
		const pendingMessages: ServerMessage[] = []
		try {
			await target.connect?.(
				session,
				this.#contextFor(nodeId, { messages: pendingMessages, session }),
			)
		} catch (connectError) {
			try {
				await target.disconnect?.(session, `migrate`, this.#contextFor(nodeId))
			} catch (cleanupError) {
				throw new AggregateError(
					[connectError, cleanupError],
					`Migration of "${clientId}" to "${nodeId}" failed`,
				)
			}
			throw connectError
		}

		this.#sessionCounters.set(clientId, ordinal)
		let disconnectError: unknown
		try {
			await this.#disconnect(clientId, `migrate`, true)
		} catch (error) {
			disconnectError = error
		}
		this.#routes.set(clientId, session)
		this.#emit(`client-connected`, session)
		for (const message of pendingMessages) {
			this.#requireClient(clientId).receive(message, session)
		}
		if (disconnectError !== undefined) {
			throw new AggregateError(
				[disconnectError],
				`Migrated "${clientId}" but failed to cleanly disconnect its previous route`,
			)
		}
		return session
	}

	/** Route a client protocol message to its connected node. */
	public async send(clientId: string, message: ClientMessage): Promise<void> {
		const session = this.#routes.get(clientId)
		if (session === undefined) {
			throw new Error(`Topology client "${clientId}" is not connected`)
		}
		this.#emit(`client-message`, {
			clientId,
			message: toDiagnosticValue(message),
			nodeId: session.nodeId,
			sessionId: session.sessionId,
		})
		await this.#requireRuntime(session.nodeId).receive(
			session,
			message,
			this.#contextFor(session.nodeId),
		)
	}

	/** Stop a node and detach all clients routed to it. */
	public async stopNode(nodeId: string): Promise<void> {
		const fixture = this.#requireNode(nodeId)
		await this.#transitionNode({
			action: () => fixture.stop(),
			details: { nodeId },
			event: `node-stopped`,
			failure: `Failed to stop topology node "${nodeId}"`,
			nodeId,
			reason: `node-stop`,
		})
	}

	/** Crash a node and detach clients without invoking node disconnect hooks. */
	public async crashNode(nodeId: string): Promise<void> {
		const fixture = this.#requireNode(nodeId)
		await this.#transitionNode({
			action: () => fixture.crash(),
			details: { nodeId },
			event: `node-crashed`,
			failure: `Failed to crash topology node "${nodeId}"`,
			nodeId,
			reason: `node-crash`,
		})
	}

	/** Restart a node, preserving durable state unless requested otherwise. */
	public async restartNode(
		nodeId: string,
		options: RestartServerOptions = {},
	): Promise<void> {
		const fixture = this.#requireNode(nodeId)
		const reason = options.mode === `crash` ? `node-crash` : `node-stop`
		await this.#transitionNode({
			action: () => fixture.restart(options),
			details: () => ({
				durability: options.durability ?? `preserve`,
				generation: fixture.generation,
				nodeId,
			}),
			detach: fixture.running,
			event: `node-restarted`,
			failure: `Failed to restart topology node "${nodeId}"`,
			nodeId,
			reason,
		})
	}

	/** Block replication in both directions between two nodes. */
	public partitionNodes(left: string, right: string): void {
		this.#requireNode(left)
		this.#requireNode(right)
		this.#partitions.add(this.#partitionKey(left, right))
		this.#emit(`partition-created`, { left, right })
	}

	/** Restore replication in both directions between two nodes. */
	public healNodes(left: string, right: string): void {
		this.#requireNode(left)
		this.#requireNode(right)
		this.#partitions.delete(this.#partitionKey(left, right))
		this.#emit(`partition-healed`, { left, right })
	}

	/** Restore every inter-node replication route. */
	public healAll(): void {
		this.#partitions.clear()
		this.#emit(`partition-healed`, { all: true })
	}

	/** Return a stable snapshot of structured topology diagnostics. */
	public getEvents(): readonly RealtimeTestTopologyEvent[] {
		return [...this.#events]
	}

	/** Return the current routes, node generations, and network partitions. */
	public getState(): RealtimeTestTopologyState {
		return {
			nodes: Object.fromEntries(
				[...this.#nodes.entries()]
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([nodeId, node]) => [
						nodeId,
						{ generation: node.generation, running: node.running },
					]),
			),
			partitions: [...this.#partitions].sort().map((key) => {
				const [left, right] = key.split(`\u0000`)
				return { left, right }
			}),
			routes: [...this.#routes.values()]
				.map((session) => ({ ...session }))
				.sort((left, right) => left.clientId.localeCompare(right.clientId)),
		}
	}

	/** Render topology diagnostics for assertion failures and test reports. */
	public formatEvents(): string {
		const events = this.#events
			.map(
				(event) =>
					`${event.sequence}. ${event.type} ${JSON.stringify(event.details)}`,
			)
			.join(`\n`)
		return `${events}${events === `` ? `` : `\n`}state ${JSON.stringify(
			this.getState(),
		)}`
	}

	async #transitionNode(options: {
		action: () => Promise<unknown>
		details:
			| Readonly<Record<string, unknown>>
			| (() => Readonly<Record<string, unknown>>)
		detach?: boolean
		event: Extract<
			RealtimeTestTopologyEvent[`type`],
			`node-crashed` | `node-restarted` | `node-stopped`
		>
		failure: string
		nodeId: string
		reason: Extract<TopologyDisconnectReason, `node-crash` | `node-stop`>
	}): Promise<void> {
		const errors: unknown[] = []
		if (options.detach ?? true) {
			try {
				await this.#detachNodeClients(options.nodeId, options.reason)
			} catch (error) {
				errors.push(error)
			}
		}
		try {
			await options.action()
		} catch (error) {
			errors.push(error)
		} finally {
			const details =
				typeof options.details === `function`
					? options.details()
					: options.details
			this.#emit(options.event, details)
		}
		if (errors.length > 0) throw new AggregateError(errors, options.failure)
	}

	async #detachNodeClients(
		nodeId: string,
		reason: Extract<TopologyDisconnectReason, `node-crash` | `node-stop`>,
	): Promise<void> {
		const clients = [...this.#routes.values()]
			.filter((session) => session.nodeId === nodeId)
			.map((session) => session.clientId)
		const errors: unknown[] = []
		for (const clientId of clients) {
			try {
				await this.#disconnect(clientId, reason, reason !== `node-crash`)
			} catch (error) {
				errors.push(error)
			}
		}
		if (errors.length > 0) {
			throw new AggregateError(
				errors,
				`Failed to detach clients from topology node "${nodeId}"`,
			)
		}
	}

	async #disconnect(
		clientId: string,
		reason: TopologyDisconnectReason,
		notifyNode: boolean,
	): Promise<void> {
		const session = this.#routes.get(clientId)
		if (session === undefined) return
		this.#routes.delete(clientId)
		const errors: unknown[] = []
		if (notifyNode) {
			try {
				await this.#requireRuntime(session.nodeId).disconnect?.(
					session,
					reason,
					this.#contextFor(session.nodeId),
				)
			} catch (error) {
				errors.push(error)
			}
		}
		try {
			this.#requireClient(clientId).disconnected?.(reason, session)
		} catch (error) {
			errors.push(error)
		}
		this.#emit(`client-disconnected`, { ...session, reason })
		if (errors.length > 0) {
			throw new AggregateError(
				errors,
				`Failed to disconnect topology client "${clientId}"`,
			)
		}
	}

	#contextFor(
		nodeId: string,
		pending?: {
			messages: ServerMessage[]
			session: TopologyClientSession
		},
	): TopologyNodeContext<ServerMessage, ReplicationMessage> {
		return {
			replicate: async (message, destinations) => {
				const peers = destinations
					? [...new Set(destinations)].filter(
							(candidate) => candidate !== nodeId,
						)
					: [...this.#nodes.keys()].filter((candidate) => candidate !== nodeId)
				for (const to of peers) {
					const envelope = { from: nodeId, message, to }
					if (this.#partitions.has(this.#partitionKey(nodeId, to))) {
						this.#emit(`replication-blocked`, {
							envelope: toDiagnosticValue(envelope),
							from: nodeId,
							to,
						})
						continue
					}
					await this.#replication.deliver(envelope, async () => {
						const target = this.#requireNode(to)
						if (!target.running) {
							this.#emit(`replication-blocked`, {
								envelope: toDiagnosticValue(envelope),
								from: nodeId,
								reason: `node-stopped`,
								to,
							})
							return
						}
						await target
							.getRuntime()
							.receiveReplication?.(envelope, this.#contextFor(to))
						this.#emit(`replication-delivered`, {
							envelope: toDiagnosticValue(envelope),
							from: nodeId,
							to,
						})
					})
				}
			},
			send: (session, message) => {
				if (pending?.session.sessionId === session.sessionId) {
					pending.messages.push(message)
					return
				}
				const route = this.#routes.get(session.clientId)
				if (route?.sessionId !== session.sessionId) return
				this.#requireClient(session.clientId).receive(message, session)
			},
		}
	}

	#emit(
		type: RealtimeTestTopologyEvent[`type`],
		details: Readonly<Record<string, unknown>>,
	): void {
		const event = {
			details: toDiagnosticValue(details) as Readonly<Record<string, unknown>>,
			sequence: ++this.#sequence,
			type,
		}
		this.#events.push(event)
		try {
			this.#onEvent?.({
				...event,
				details: toDiagnosticValue(event.details) as Readonly<
					Record<string, unknown>
				>,
			})
		} catch {
			// Diagnostic observers must not change the topology operation outcome.
		}
	}

	#partitionKey(left: string, right: string): string {
		return [left, right].sort().join(`\u0000`)
	}

	#requireClient(clientId: string): RealtimeTestTopologyClient<ServerMessage> {
		const client = this.#clients.get(clientId)
		if (client === undefined) {
			throw new Error(`Unknown topology client "${clientId}"`)
		}
		return client
	}

	#requireNode(
		nodeId: string,
	): AnyServerFixture<ClientMessage, ServerMessage, ReplicationMessage> {
		const node = this.#nodes.get(nodeId)
		if (node === undefined) throw new Error(`Unknown topology node "${nodeId}"`)
		return node
	}

	#requireRuntime(
		nodeId: string,
	): RealtimeTestTopologyNode<ClientMessage, ServerMessage, ReplicationMessage> {
		return this.#requireNode(nodeId).getRuntime()
	}
}

/** Create a controllable multi-node realtime test topology. */
export function createRealtimeTestTopology<
	ClientMessage,
	ServerMessage,
	ReplicationMessage,
>(
	options: RealtimeTestTopologyOptions<
		ClientMessage,
		ServerMessage,
		ReplicationMessage
	>,
): RealtimeTestTopology<ClientMessage, ServerMessage, ReplicationMessage> {
	return new RealtimeTestTopology(options)
}
