import type { Silo } from "atom.io"
import type {
	MosaicTextIndexLookup,
	MosaicTextSelection,
} from "atom.io/realtime"
import {
	createMosaicDomainHistoryClient,
	createMosaicDomainHistorySocketTransport,
	createMosaicDomainPresenceClient,
	createMosaicDomainPresenceSocketTransport,
	createMosaicDomainResidencyClient,
	createMosaicDomainResidencySocketTransport,
	createMosaicDomainSessionClient,
	createMosaicTextProjectionClient,
	type MosaicDomainHistoryClient,
	type MosaicDomainPresenceClient,
	type MosaicDomainResidencyClient,
	type MosaicDomainSessionClientState,
	type MosaicTextProjectionClient,
	type MosaicTextLogicalEdit,
} from "atom.io/realtime-client"
import type { Socket } from "socket.io-client"

import {
	activateMarkdownDocumentDomain,
	markdownPresenceKey,
	type MarkdownDocumentDomain,
	type MarkdownPresence,
} from "./document-domain.ts"
import type { Identity } from "./identities.ts"
import {
	MARKDOWN_EVENTS,
	type MarkdownAcknowledgement,
	type MarkdownCommand,
} from "./protocol.ts"

type MarkdownRange = { end: number; kind: `utf16-range`; start: number }
export type MarkdownClientStatus = MosaicDomainSessionClientState

export type MarkdownCollaborationClient = Disposable & {
	readonly domain: MarkdownDocumentDomain
	readonly history: MosaicDomainHistoryClient
	readonly identity: Identity
	readonly presence: MosaicDomainPresenceClient
	readonly projection: MosaicTextProjectionClient<
		MarkdownDocumentDomain[`identity`],
		MarkdownRange
	>
	publishPresence(
		value: Omit<MarkdownPresence, `actor` | `session`>,
	): Promise<void>
	redo(): Promise<boolean>
	replace(input: {
		readonly selection: MosaicTextSelection
		readonly text: string
	}): Promise<void>
	readonly residency: MosaicDomainResidencyClient<
		MarkdownDocumentDomain[`identity`],
		MarkdownRange
	>
	readonly sessionId: string
	status(): MarkdownClientStatus
	subscribe(listener: (status: MarkdownClientStatus) => void): () => void
	undo(): Promise<boolean>
}

const request = <Value>(
	socket: Socket,
	event: string,
	...parameters: readonly unknown[]
): Promise<Value> =>
	new Promise((resolve, reject) => {
		if (!socket.connected) {
			reject(new Error(`offline`))
			return
		}
		let settled = false
		const finish = (result: () => void): void => {
			if (settled) return
			settled = true
			socket.off(`disconnect`, disconnected)
			result()
		}
		const disconnected = (): void => {
			finish(() => {
				reject(new DOMException(`Socket disconnected`, `AbortError`))
			})
		}
		socket.once(`disconnect`, disconnected)
		socket.emit(
			event,
			...parameters,
			(acknowledgement: MarkdownAcknowledgement<Value>) => {
				finish(() => {
					if (acknowledgement.ok) resolve(acknowledgement.value)
					else reject(new Error(acknowledgement.reason))
				})
			},
		)
	})

export async function createMarkdownCollaborationClient(options: {
	readonly identity: Identity
	readonly presenceRenewalMs?: number
	readonly sessionId: string
	readonly silo: Pick<Silo, `install` | `store`>
	readonly socket: Socket
}): Promise<MarkdownCollaborationClient> {
	const { identity, sessionId, socket } = options
	const presenceRenewalMs = options.presenceRenewalMs ?? 5_000
	if (!Number.isSafeInteger(presenceRenewalMs) || presenceRenewalMs < 1) {
		throw new Error(`Presence renewal must be a positive integer.`)
	}
	const domain = await activateMarkdownDocumentDomain({ silo: options.silo })
	const residencyTransport = createMosaicDomainResidencySocketTransport<
		MarkdownDocumentDomain[`identity`],
		MarkdownRange
	>(socket, {
		idSource: () => `${sessionId}:residency:${crypto.randomUUID()}`,
	})
	const residency = createMosaicDomainResidencyClient({
		actor: identity.id,
		domain,
		maxResidentBytes: 4 * 1024 * 1024,
		maxResidentMembers: 128,
		session: sessionId,
		transport: residencyTransport,
	})
	const projection = createMosaicTextProjectionClient({
		actor: identity.id,
		domainKey: `markdown-body`,
		evictReleased: true,
		materialize: () => request(socket, MARKDOWN_EVENTS.materialize),
		maximumActiveRanges: 8,
		maximumRangeUtf16Units: 65_536,
		planEdit(_edit: MosaicTextLogicalEdit) {
			throw new Error(
				`Markdown commands are authoritatively composed with index maintenance.`,
			)
		},
		positionAtOffset: (offset) =>
			request<MosaicTextIndexLookup>(
				socket,
				MARKDOWN_EVENTS.positionAtOffset,
				offset,
			),
		rangeMember: `indexMembers`,
		rangeMemberLimit: 64,
		residency,
		resolvePosition: (position) =>
			request(socket, MARKDOWN_EVENTS.resolvePosition, position),
		rootAddress: domain.address(`indexRoot`),
		session: sessionId,
	})
	const presenceTransport = createMosaicDomainPresenceSocketTransport(socket, {
		idSource: () => `${sessionId}:presence:${crypto.randomUUID()}`,
	})
	const presence = createMosaicDomainPresenceClient({
		domain,
		renewalMs: presenceRenewalMs,
		session: sessionId,
		transport: presenceTransport,
	})
	const historyTransport = createMosaicDomainHistorySocketTransport(socket, {
		idSource: () => `${sessionId}:history:${crypto.randomUUID()}`,
	})
	const history = createMosaicDomainHistoryClient({
		actor: identity.id,
		onObserverError: (error) => {
			domain.store.logger.error(
				`🐞`,
				`unknown`,
				sessionId,
				`A Mosaic Domain history client listener threw.`,
				error,
			)
		},
		session: sessionId,
		transport: historyTransport,
	})
	const session = await createMosaicDomainSessionClient<MarkdownCommand>({
		history,
		presence,
		residency,
		send: (command) => request(socket, MARKDOWN_EVENTS.command, command),
		socket,
	})

	return {
		domain,
		history,
		identity,
		presence,
		projection,
		publishPresence(value) {
			const latest = structuredClone({
				...value,
				actor: identity.id,
				session: sessionId,
			})
			return presence.publish(
				domain.address(`collaborator`, markdownPresenceKey(latest)),
				latest,
			)
		},
		redo: () => session.history(`redo`),
		replace({ selection, text }) {
			return session.submit((sequence) => ({
				anchor: selection.anchor,
				gestureId: `${identity.id}:${sessionId}:edit:${sequence}`,
				head: selection.head,
				sequence,
				text,
				type: `replace`,
			}))
		},
		residency,
		sessionId,
		status: session.state,
		subscribe: session.subscribe,
		undo: () => session.history(`undo`),
		[Symbol.dispose]() {
			session[Symbol.dispose]()
			presence[Symbol.dispose]()
			presenceTransport[Symbol.dispose]()
			history[Symbol.dispose]()
			historyTransport[Symbol.dispose]()
			void projection
				.dispose()
				.catch(() => undefined)
				.then(() => residency.dispose())
				.catch(() => undefined)
				.finally(() => {
					domain[Symbol.dispose]()
				})
		},
	}
}
