import type { Silo } from "atom.io"
import type {
	MosaicAcceptedDomainBatchEnvelope,
	MosaicDomainBatchProposal,
	MosaicDomainResidencyTransport,
} from "atom.io/realtime"
import {
	createMosaicDomainBatchClient,
	createMosaicDomainHistoryClient,
	createMosaicDomainHistorySocketTransport,
	createMosaicDomainPresenceClient,
	createMosaicDomainPresenceSocketTransport,
	createMosaicDomainResidencyClient,
	type MosaicDomainBatchClient,
	type MosaicDomainBatchClientTransport,
	type MosaicDomainHistoryClient,
	type MosaicDomainPresenceClient,
	type MosaicDomainResidencyClient,
} from "atom.io/realtime-client"
import type { Socket } from "socket.io-client"

import {
	activateSvgDesignDomain,
	createSvgDomainEditor,
	svgCollaborationPresenceKey,
	type SvgCollaborationPresence,
	type SvgDesignDomain,
	type SvgDomainEditor,
} from "./design-model.ts"
import type { Identity } from "./identities.ts"
import {
	VECTOR_BATCH_EVENTS,
	VECTOR_RESIDENCY_EVENTS,
	type VectorAcknowledgement,
} from "./protocol.ts"

export type VectorClientStatus = {
	readonly connection: `connecting` | `live` | `offline` | `rejected`
	readonly pending: number
	readonly reason: string | null
}

export type VectorClientStore = Pick<
	Silo,
	`getState` | `install` | `setState` | `store`
>

export type VectorCollaborationClient = Disposable & {
	readonly batch: MosaicDomainBatchClient
	readonly domain: SvgDesignDomain
	readonly editor: SvgDomainEditor
	readonly identity: Identity
	readonly history: MosaicDomainHistoryClient
	readonly presence: MosaicDomainPresenceClient
	readonly residency: MosaicDomainResidencyClient<SvgDesignDomain[`identity`]>
	readonly sessionId: string
	readonly silo: VectorClientStore
	readonly socket: Socket
	status(): VectorClientStatus
	subscribe(listener: (status: VectorClientStatus) => void): () => void
}

function batchTransport(socket: Socket): MosaicDomainBatchClientTransport {
	const request = <Value>(
		emit: (
			acknowledge: (acknowledgement: VectorAcknowledgement<Value>) => void,
		) => void,
	): Promise<Value> =>
		new Promise((resolve, reject) => {
			emit((acknowledgement) => {
				if (acknowledgement.ok) resolve(acknowledgement.value)
				else reject(new Error(acknowledgement.reason))
			})
		})
	return {
		propose(batch: MosaicDomainBatchProposal) {
			if (!socket.connected) return Promise.reject(new Error(`offline`))
			return request((acknowledge) => {
				socket.emit(VECTOR_BATCH_EVENTS.propose, batch, acknowledge)
			})
		},
		recover(afterRevision = 0) {
			if (!socket.connected) return Promise.reject(new Error(`offline`))
			return request((acknowledge) => {
				socket.emit(VECTOR_BATCH_EVENTS.recover, afterRevision, acknowledge)
			})
		},
		subscribe(listener: (accepted: MosaicAcceptedDomainBatchEnvelope) => void) {
			const receive = (accepted: MosaicAcceptedDomainBatchEnvelope): void => {
				listener(accepted)
			}
			socket.on(VECTOR_BATCH_EVENTS.accepted, receive)
			return () => socket.off(VECTOR_BATCH_EVENTS.accepted, receive)
		},
	}
}

function residencyTransport(
	socket: Socket,
): MosaicDomainResidencyTransport<SvgDesignDomain[`identity`]> {
	let subscriptionSequence = 0
	const request = <Value>(
		event: string,
		...parameters: readonly unknown[]
	): Promise<Value> =>
		new Promise((resolve, reject) => {
			if (!socket.connected) {
				reject(new Error(`offline`))
				return
			}
			socket.emit(
				event,
				...parameters,
				(acknowledgement: VectorAcknowledgement<Value>) => {
					if (acknowledgement.ok) resolve(acknowledgement.value)
					else reject(new Error(acknowledgement.reason))
				},
			)
		})
	return {
		hydrate: (requests) => request(VECTOR_RESIDENCY_EVENTS.hydrate, requests),
		propose: (proposal) => request(VECTOR_RESIDENCY_EVENTS.propose, proposal),
		subscribe(requests, listener) {
			const id = `vector-residency:${subscriptionSequence++}`
			const receive = (incomingId: string, accepted: unknown): void => {
				if (incomingId === id) listener(accepted as never)
			}
			socket.on(VECTOR_RESIDENCY_EVENTS.accepted, receive)
			return request<void>(VECTOR_RESIDENCY_EVENTS.subscribe, id, requests).then(
				() => () => {
					socket.off(VECTOR_RESIDENCY_EVENTS.accepted, receive)
					socket.emit(VECTOR_RESIDENCY_EVENTS.unsubscribe, id)
				},
			)
		},
	}
}

export async function createVectorCollaborationClient(options: {
	readonly identity: Identity
	readonly sessionId: string
	readonly silo: VectorClientStore
	readonly socket: Socket
}): Promise<VectorCollaborationClient> {
	const domain = await activateSvgDesignDomain({
		instance: `shared-drawing`,
		silo: options.silo,
	})
	const batch = createMosaicDomainBatchClient({
		actor: options.identity.id,
		domain,
		session: options.sessionId,
		transport: batchTransport(options.socket),
	})
	const residency = createMosaicDomainResidencyClient({
		actor: options.identity.id,
		domain,
		maxResidentBytes: 4 * 1024 * 1024,
		maxResidentMembers: 256,
		session: options.sessionId,
		transport: residencyTransport(options.socket),
	})
	const presenceTransport = createMosaicDomainPresenceSocketTransport(
		options.socket,
		{ idSource: () => `${options.sessionId}:presence:${crypto.randomUUID()}` },
	)
	const presence = createMosaicDomainPresenceClient({
		domain,
		session: options.sessionId,
		transport: presenceTransport,
	})
	const historyTransport = createMosaicDomainHistorySocketTransport(
		options.socket,
		{ idSource: () => `${options.sessionId}:history:${crypto.randomUUID()}` },
	)
	const history = createMosaicDomainHistoryClient({
		actor: options.identity.id,
		onObserverError: (error) =>
			domain.store.logger.error(
				`🐞`,
				`unknown`,
				options.sessionId,
				`A Mosaic Domain history client listener threw.`,
				error,
			),
		session: options.sessionId,
		transport: historyTransport,
	})
	const editor = createSvgDomainEditor({
		batch,
		domain,
		history,
		presence,
		state: { getState: options.silo.getState, setState: options.silo.setState },
	})
	const listeners = new Set<(status: VectorClientStatus) => void>()
	const status = (): VectorClientStatus => {
		const batchState = batch.state
		const historyState = history.state
		const presenceState = presence.state
		const rejected =
			batchState.status === `rejected` ||
			historyState.status === `rejected` ||
			presenceState.status === `rejected`
		const offline =
			batchState.status === `offline` ||
			historyState.status === `offline` ||
			presenceState.status === `offline` ||
			residency.state.connectivity === `offline`
		return {
			connection: rejected
				? `rejected`
				: offline
					? `offline`
					: batchState.status === `live` &&
						  historyState.status === `live` &&
						  presenceState.status === `live` &&
						  residency.state.connectivity === `live`
						? `live`
						: `connecting`,
			pending:
				batchState.pendingBatchIds.length +
				historyState.pending +
				presenceState.pending +
				residency.state.pendingBatchIds.length,
			reason:
				batchState.problem?.reason ??
				historyState.problem?.reason ??
				presenceState.problem?.reason ??
				residency.state.problem?.reason ??
				null,
		}
	}
	const notify = (): void => {
		const next = status()
		for (const listener of listeners) listener(next)
	}
	const unsubscribeBatch = batch.subscribe(notify)
	const unsubscribeHistory = history.subscribe(notify)
	const unsubscribePresence = presence.subscribe(notify)
	const unsubscribeResidency = residency.subscribeState(notify)
	const synchronize = async (): Promise<void> => {
		await batch.start()
		await batch.flush()
		try {
			await presence.start()
		} catch {
			// A refresh still retains the actionable offline/rejected state.
		}
		await presence.refresh()
		await residency.reconnect()
		if (history.state.snapshot === null) await history.start()
		else await history.refresh()
	}
	const reconnect = (): void => {
		void synchronize().then(notify, notify)
	}
	const disconnect = (): void => {
		void editor.finishDrag({ commit: false }).then(notify, notify)
	}
	options.socket.on(`connect`, reconnect)
	options.socket.on(`disconnect`, disconnect)
	if (options.socket.connected) {
		await synchronize().catch(() => undefined)
	}
	notify()

	return {
		batch,
		domain,
		editor,
		history,
		identity: options.identity,
		presence,
		residency,
		sessionId: options.sessionId,
		silo: options.silo,
		socket: options.socket,
		status,
		subscribe(listener: (status: VectorClientStatus) => void) {
			listeners.add(listener)
			listener(status())
			return () => listeners.delete(listener)
		},
		[Symbol.dispose]() {
			options.socket.off(`connect`, reconnect)
			options.socket.off(`disconnect`, disconnect)
			unsubscribeBatch()
			unsubscribeHistory()
			unsubscribePresence()
			unsubscribeResidency()
			presence[Symbol.dispose]()
			presenceTransport[Symbol.dispose]()
			history[Symbol.dispose]()
			historyTransport[Symbol.dispose]()
			batch[Symbol.dispose]()
			void residency.dispose()
			domain[Symbol.dispose]()
			listeners.clear()
		},
	}
}

export function publishCollaboratorPresence(
	client: VectorCollaborationClient,
	value: Omit<SvgCollaborationPresence, `actor` | `session`>,
): Promise<void> {
	const presence: SvgCollaborationPresence = {
		...value,
		actor: client.identity.id,
		session: client.sessionId,
	}
	return client.presence.publish(
		client.domain.address(`collaborator`, svgCollaborationPresenceKey(presence)),
		presence,
	)
}
