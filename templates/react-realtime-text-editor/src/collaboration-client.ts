import type { Silo } from "atom.io"
import type {
	MosaicDomainResidencyTransport,
	MosaicTextIndexLookup,
	MosaicTextSelection,
} from "atom.io/realtime"
import {
	createMosaicDomainHistoryClient,
	createMosaicDomainHistorySocketTransport,
	createMosaicDomainPresenceClient,
	createMosaicDomainPresenceSocketTransport,
	createMosaicDomainResidencyClient,
	createMosaicTextProjectionClient,
	type MosaicDomainPresenceClient,
	type MosaicDomainHistoryClient,
	type MosaicDomainResidencyClient,
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

export type MarkdownClientStatus = {
	readonly connection: `connecting` | `live` | `offline` | `recovering`
	readonly pending: number
	readonly reason: string | null
}

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
		const disconnected = (): void =>
			finish(() => reject(new DOMException(`Socket disconnected`, `AbortError`)))
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

function residencyTransport(
	socket: Socket,
): MosaicDomainResidencyTransport<
	MarkdownDocumentDomain[`identity`],
	MarkdownRange
> {
	let subscriptionSequence = 0
	return {
		hydrate: (requests) => request(socket, MARKDOWN_EVENTS.hydrate, requests),
		propose: (proposal) => request(socket, MARKDOWN_EVENTS.recover, proposal),
		subscribe(requests, listener) {
			const id = `range:${subscriptionSequence++}`
			const receive = (incomingId: string, accepted: unknown): void => {
				if (incomingId === id) listener(accepted as never)
			}
			socket.on(MARKDOWN_EVENTS.accepted, receive)
			return request<void>(socket, MARKDOWN_EVENTS.subscribe, id, requests).then(
				() => () => {
					socket.off(MARKDOWN_EVENTS.accepted, receive)
					socket.emit(MARKDOWN_EVENTS.unsubscribe, id)
				},
			)
		},
	}
}

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
	const transport = residencyTransport(socket)
	const residency = createMosaicDomainResidencyClient({
		actor: identity.id,
		domain,
		maxResidentBytes: 4 * 1024 * 1024,
		maxResidentMembers: 128,
		session: sessionId,
		transport,
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
		session: sessionId,
		transport: presenceTransport,
	})
	const historyTransport = createMosaicDomainHistorySocketTransport(socket, {
		idSource: () => `${sessionId}:history-socket:${crypto.randomUUID()}`,
	})
	const history = createMosaicDomainHistoryClient({
		actor: identity.id,
		onObserverError: (error) =>
			domain.store.logger.error(
				`🐞`,
				`unknown`,
				sessionId,
				`A Mosaic Domain history client listener threw.`,
				error,
			),
		session: sessionId,
		transport: historyTransport,
	})
	let commandSequence = 0
	let pendingCommands = 0
	let disposed = false
	let latestPresence: MarkdownPresence | null = null
	const connectionWaiters = new Set<() => void>()
	let commandTail = Promise.resolve()
	let synchronization = Promise.resolve()
	const listeners = new Set<(status: MarkdownClientStatus) => void>()

	const status = (): MarkdownClientStatus => {
		const historyState = history.state
		const residencyState = residency.state
		return {
			connection:
				historyState.status === `rejected`
					? `recovering`
					: !socket.connected ||
						  historyState.status === `offline` ||
						  residencyState.connectivity === `offline`
						? `offline`
						: historyState.status === `live` &&
							  residencyState.connectivity === `live`
							? `live`
							: `connecting`,
			pending:
				pendingCommands +
				historyState.pending +
				residencyState.pendingBatchIds.length,
			reason:
				residencyState.problem?.reason ?? historyState.problem?.reason ?? null,
		}
	}
	const notify = (): void => {
		const value = status()
		for (const listener of listeners) listener(value)
	}
	const publishLatestPresence = async (): Promise<void> => {
		if (latestPresence === null) return
		await presence.publish(
			domain.address(`collaborator`, markdownPresenceKey(latestPresence)),
			latestPresence,
		)
	}
	const synchronize = async (): Promise<void> => {
		await residency.reconnect()
		try {
			await presence.start()
		} catch {
			// Presence is advisory and retains its actionable state.
		}
		await presence.refresh()
		await publishLatestPresence().catch(() => undefined)
		if (history.state.snapshot === null) await history.start()
		else await history.refresh()
		notify()
	}
	const waitForConnection = (): Promise<void> =>
		new Promise((resolve, reject) => {
			let settled = false
			const cleanup = (): void => {
				socket.off(`connect`, onConnect)
				connectionWaiters.delete(onDispose)
			}
			const onConnect = (): void => {
				if (settled) return
				settled = true
				cleanup()
				resolve()
			}
			const onDispose = (): void => {
				if (settled) return
				settled = true
				cleanup()
				reject(new Error(`The Markdown client is disposed.`))
			}
			socket.once(`connect`, onConnect)
			connectionWaiters.add(onDispose)
			if (socket.connected) onConnect()
			else if (disposed) onDispose()
		})
	const sendCommand = async (command: MarkdownCommand): Promise<void> => {
		for (;;) {
			if (disposed) throw new Error(`The Markdown client is disposed.`)
			if (!socket.connected) await waitForConnection()
			try {
				await synchronization
				if (disposed) throw new Error(`The Markdown client is disposed.`)
				if (!socket.connected) continue
				await request(socket, MARKDOWN_EVENTS.command, command)
				return
			} catch (error) {
				if (
					!socket.connected ||
					(error instanceof Error &&
						(error.message === `offline` || error.name === `AbortError`))
				) {
					continue
				}
				throw error
			}
		}
	}
	const submit = (
		command: Omit<Extract<MarkdownCommand, { type: `replace` }>, `sequence`>,
	): Promise<void> => {
		pendingCommands++
		notify()
		const sequence = ++commandSequence
		const work = commandTail.then(async () => {
			await sendCommand({ ...command, sequence })
			await history.refresh()
		})
		commandTail = work.then(
			() => undefined,
			() => undefined,
		)
		return work.finally(() => {
			pendingCommands--
			notify()
		})
	}
	const requestHistory = async (mode: `redo` | `undo`): Promise<boolean> => {
		await history.refresh()
		const snapshot = history.state.snapshot!
		if (
			mode === `undo` ? !snapshot.horizon.canUndo : !snapshot.horizon.canRedo
		) {
			return false
		}
		const result = await history.request(mode)
		if (result.status === `rejected`) throw new Error(result.reason)
		return result.status === `accepted`
	}
	const stopResidency = residency.subscribeState(notify)
	const stopPresence = presence.subscribe(notify)
	const stopHistory = history.subscribe(notify)
	let presenceRenewalInFlight = false
	const presenceRenewalTimer = setInterval(() => {
		if (
			disposed ||
			!socket.connected ||
			latestPresence === null ||
			presence.state.pending > 0 ||
			presenceRenewalInFlight
		) {
			return
		}
		presenceRenewalInFlight = true
		void publishLatestPresence()
			.catch(() => undefined)
			.finally(() => {
				presenceRenewalInFlight = false
			})
	}, presenceRenewalMs)
	;(presenceRenewalTimer as { unref?: () => void }).unref?.()
	const reconnect = (): void => {
		synchronization = synchronize()
		void synchronization.catch(notify)
	}
	const disconnect = (): void => notify()
	socket.on(`connect`, reconnect)
	socket.on(`disconnect`, disconnect)
	if (socket.connected) {
		synchronization = synchronize()
		await synchronization.catch(() => undefined)
	}

	return {
		domain,
		history,
		identity,
		presence,
		projection,
		publishPresence(value) {
			latestPresence = structuredClone({
				...value,
				actor: identity.id,
				session: sessionId,
			})
			return publishLatestPresence()
		},
		redo: () => requestHistory(`redo`),
		replace({ selection, text }) {
			return submit({
				anchor: selection.anchor,
				gestureId: `${identity.id}:${sessionId}:edit:${commandSequence + 1}`,
				head: selection.head,
				text,
				type: `replace`,
			})
		},
		residency,
		sessionId,
		status,
		subscribe(listener) {
			listeners.add(listener)
			listener(status())
			return () => listeners.delete(listener)
		},
		undo: () => requestHistory(`undo`),
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			clearInterval(presenceRenewalTimer)
			for (const cancel of [...connectionWaiters]) cancel()
			connectionWaiters.clear()
			socket.off(`connect`, reconnect)
			socket.off(`disconnect`, disconnect)
			stopResidency()
			stopPresence()
			stopHistory()
			presence[Symbol.dispose]()
			presenceTransport[Symbol.dispose]()
			history[Symbol.dispose]()
			historyTransport[Symbol.dispose]()
			void projection
				.dispose()
				.catch(() => undefined)
				.then(() => residency.dispose())
				.catch(() => undefined)
				.finally(() => domain[Symbol.dispose]())
			listeners.clear()
		},
	}
}
