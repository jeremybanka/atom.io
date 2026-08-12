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
		this.#sessionCounters.set(clientId, ordinal)
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
		if (this.#routes.has(clientId)) {
			await this.#disconnect(clientId, `migrate`, true)
		}
		return this.connect(clientId, nodeId)
	}

	/** Route a client protocol message to its connected node. */
	public async send(clientId: string, message: ClientMessage): Promise<void> {
		const session = this.#routes.get(clientId)
		if (session === undefined) {
			throw new Error(`Topology client "${clientId}" is not connected`)
		}
		this.#emit(`client-message`, {
			clientId,
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
		await this.#detachNodeClients(nodeId, `node-stop`)
		await fixture.stop()
		this.#emit(`node-stopped`, { nodeId })
	}

	/** Crash a node and detach clients without invoking node disconnect hooks. */
	public async crashNode(nodeId: string): Promise<void> {
		const fixture = this.#requireNode(nodeId)
		await this.#detachNodeClients(nodeId, `node-crash`)
		await fixture.crash()
		this.#emit(`node-crashed`, { nodeId })
	}

	/** Restart a node, preserving durable state unless requested otherwise. */
	public async restartNode(
		nodeId: string,
		options: RestartServerOptions = {},
	): Promise<void> {
		const fixture = this.#requireNode(nodeId)
		if (fixture.running) {
			const reason = options.mode === `crash` ? `node-crash` : `node-stop`
			await this.#detachNodeClients(nodeId, reason)
		}
		await fixture.restart(options)
		this.#emit(`node-restarted`, {
			durability: options.durability ?? `preserve`,
			generation: fixture.generation,
			nodeId,
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

	/** Render topology diagnostics for assertion failures and test reports. */
	public formatEvents(): string {
		return this.#events
			.map(
				(event) =>
					`${event.sequence}. ${event.type} ${JSON.stringify(event.details)}`,
			)
			.join(`\n`)
	}

	async #detachNodeClients(
		nodeId: string,
		reason: Extract<TopologyDisconnectReason, `node-crash` | `node-stop`>,
	): Promise<void> {
		const clients = [...this.#routes.values()]
			.filter((session) => session.nodeId === nodeId)
			.map((session) => session.clientId)
		for (const clientId of clients) {
			await this.#disconnect(clientId, reason, reason !== `node-crash`)
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
		if (notifyNode) {
			await this.#requireRuntime(session.nodeId).disconnect?.(
				session,
				reason,
				this.#contextFor(session.nodeId),
			)
		}
		this.#requireClient(clientId).disconnected?.(reason, session)
		this.#emit(`client-disconnected`, { ...session, reason })
	}

	#contextFor(
		nodeId: string,
	): TopologyNodeContext<ServerMessage, ReplicationMessage> {
		return {
			replicate: async (message, destinations) => {
				const peers =
					destinations ??
					[...this.#nodes.keys()].filter((candidate) => candidate !== nodeId)
				for (const to of peers) {
					const envelope = { from: nodeId, message, to }
					if (this.#partitions.has(this.#partitionKey(nodeId, to))) {
						this.#emit(`replication-blocked`, { from: nodeId, to })
						continue
					}
					await this.#replication.deliver(envelope, async () => {
						const target = this.#requireNode(to)
						if (!target.running) {
							this.#emit(`replication-blocked`, {
								from: nodeId,
								reason: `node-stopped`,
								to,
							})
							return
						}
						await target
							.getRuntime()
							.receiveReplication?.(envelope, this.#contextFor(to))
						this.#emit(`replication-delivered`, { from: nodeId, to })
					})
				}
			},
			send: (session, message) => {
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
		const event = { details, sequence: ++this.#sequence, type }
		this.#events.push(event)
		this.#onEvent?.(event)
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
