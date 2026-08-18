import type { Silo } from "atom.io"
import type {
	MosaicAcceptedDomainBatchEnvelope,
	MosaicDomainBatchProposal,
} from "atom.io/realtime"
import {
	createMosaicDomainBatchClient,
	createMosaicDomainPresenceClient,
	createMosaicDomainPresenceSocketTransport,
	type MosaicDomainBatchClient,
	type MosaicDomainBatchClientTransport,
	type MosaicDomainPresenceClient,
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
import { VECTOR_BATCH_EVENTS, type VectorAcknowledgement } from "./protocol.ts"

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
	readonly presence: MosaicDomainPresenceClient
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
	const presenceTransport = createMosaicDomainPresenceSocketTransport(
		options.socket,
		{ idSource: () => `${options.sessionId}:presence:${crypto.randomUUID()}` },
	)
	const presence = createMosaicDomainPresenceClient({
		domain,
		session: options.sessionId,
		transport: presenceTransport,
	})
	const editor = createSvgDomainEditor({
		batch,
		domain,
		presence,
		state: { getState: options.silo.getState, setState: options.silo.setState },
	})
	const listeners = new Set<(status: VectorClientStatus) => void>()
	const status = (): VectorClientStatus => {
		const batchState = batch.state
		const presenceState = presence.state
		const rejected =
			batchState.status === `rejected` || presenceState.status === `rejected`
		const offline =
			batchState.status === `offline` || presenceState.status === `offline`
		return {
			connection: rejected
				? `rejected`
				: offline
					? `offline`
					: batchState.status === `live` && presenceState.status === `live`
						? `live`
						: `connecting`,
			pending: batchState.pendingBatchIds.length + presenceState.pending,
			reason:
				batchState.problem?.reason ?? presenceState.problem?.reason ?? null,
		}
	}
	const notify = (): void => {
		const next = status()
		for (const listener of listeners) listener(next)
	}
	const unsubscribeBatch = batch.subscribe(notify)
	const unsubscribePresence = presence.subscribe(notify)
	const synchronize = async (): Promise<void> => {
		await batch.start()
		await batch.flush()
		try {
			await presence.start()
		} catch {
			// A refresh still retains the actionable offline/rejected state.
		}
		await presence.refresh()
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
		identity: options.identity,
		presence,
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
			unsubscribePresence()
			presence[Symbol.dispose]()
			presenceTransport[Symbol.dispose]()
			batch[Symbol.dispose]()
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
