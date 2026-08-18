import { type Canonical, packCanonical } from "atom.io/foundations/canonical"
import type { Json } from "atom.io/foundations/json"
import {
	assertMosaicDomainPresenceProposal,
	DEFAULT_MOSAIC_DOMAIN_PRESENCE_LIMITS,
	type MosaicDomainInstance,
	mosaicDomainMemberAddressKey,
	type MosaicDomainPresenceCleanup,
	type MosaicDomainPresenceEnvelope,
	type MosaicDomainPresenceLimits,
	type MosaicDomainPresenceProposal,
	type MosaicDomainPresenceRejection,
	type MosaicDomainPresenceResult,
	type MosaicDomainPresenceSnapshot,
} from "atom.io/realtime"

export type MosaicDomainPresenceServerOptions = {
	readonly domain: MosaicDomainInstance<any, any, any>
	readonly limits?: Partial<MosaicDomainPresenceLimits>
	readonly now?: () => number
	/** Presence lifetime after its last accepted update. Defaults to 15 seconds. */
	readonly ttlMs?: number
}

export type MosaicDomainPresenceConnection = {
	disconnect(reason?: `disconnect`): Promise<void>
	publish(
		proposal: MosaicDomainPresenceProposal,
	): Promise<MosaicDomainPresenceResult>
	snapshot(): Promise<MosaicDomainPresenceSnapshot>
	subscribe(
		listener: (presence: MosaicDomainPresenceEnvelope) => void,
	): () => void
}

export type MosaicDomainPresenceServer = Disposable & {
	connect(identity: {
		readonly actor: string
		readonly session: string
	}): MosaicDomainPresenceConnection
	/** Remove a quiescent cursor only after an authentication/session epoch is retired. */
	forgetSession(actor: string, session: string): boolean
	subscribeCleanup(
		listener: (cleanup: MosaicDomainPresenceCleanup) => void,
	): () => void
	sweepExpired(): Promise<number>
}

type SessionState = {
	active: boolean
	count: number
	sequence: number
	windowStartedAt: number
}

type LivePresence = {
	envelope: MosaicDomainPresenceEnvelope
	owner: string
}

const identityKey = (actor: string, session: string): string =>
	`${actor}\u0000${session}`

const presenceKey = (presence: {
	readonly actor: string
	readonly address: MosaicDomainPresenceEnvelope[`address`]
	readonly session: string
}): string =>
	`${identityKey(presence.actor, presence.session)}\u0000${mosaicDomainMemberAddressKey(presence.address)}`

const rejection = (
	code: MosaicDomainPresenceRejection[`code`],
	reason: string,
	sequence: number | null,
	recovery: MosaicDomainPresenceRejection[`recovery`],
): MosaicDomainPresenceResult => ({
	rejection: { code, reason, recovery, sequence },
	status: `rejected`,
})

function identifier(value: string): boolean {
	return value.length > 0 && value.length <= 512
}

/**
 * Coordinate schema-validated ephemeral Domain members without durable append.
 * Session cursors are retained until `forgetSession` so delayed packets cannot
 * resurrect cleared presence.
 */
export function createMosaicDomainPresenceServer(
	options: MosaicDomainPresenceServerOptions,
): MosaicDomainPresenceServer {
	const now = options.now ?? Date.now
	const ttlMs = options.ttlMs ?? 15_000
	if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
		throw new Error(`Mosaic Domain presence ttlMs must be a positive integer.`)
	}
	const limits: MosaicDomainPresenceLimits = {
		...DEFAULT_MOSAIC_DOMAIN_PRESENCE_LIMITS,
		...options.limits,
	}
	for (const [name, limit] of Object.entries(limits)) {
		if (!Number.isSafeInteger(limit) || limit < 1) {
			throw new Error(`Mosaic Domain presence ${name} must be positive.`)
		}
	}
	const sessions = new Map<string, SessionState>()
	const live = new Map<string, LivePresence>()
	const slots = new Map<string, string>()
	const listeners = new Set<(presence: MosaicDomainPresenceEnvelope) => void>()
	const cleanupListeners = new Set<
		(cleanup: MosaicDomainPresenceCleanup) => void
	>()
	let disposed = false
	let pending = 0
	let tail = Promise.resolve()

	const broadcast = (presence: MosaicDomainPresenceEnvelope): void => {
		for (const listener of listeners) {
			try {
				listener(structuredClone(presence))
			} catch (error) {
				options.domain.store.logger.error(
					`🐞`,
					`unknown`,
					presence.session,
					`A Mosaic Domain presence listener threw.`,
					error,
				)
			}
		}
	}

	const clearEntry = (
		key: string,
		current: LivePresence,
		state: SessionState,
		reason: MosaicDomainPresenceCleanup[`reason`],
	): void => {
		live.delete(key)
		const addressKey = mosaicDomainMemberAddressKey(current.envelope.address)
		if (slots.get(addressKey) === current.owner) slots.delete(addressKey)
		state.sequence++
		const presence: MosaicDomainPresenceEnvelope = {
			actor: current.envelope.actor,
			address: current.envelope.address,
			domain: current.envelope.domain,
			expiresAt: null,
			kind: `clear`,
			protocolVersion: current.envelope.protocolVersion,
			sequence: state.sequence,
			session: current.envelope.session,
		}
		broadcast(presence)
		for (const listener of cleanupListeners) {
			try {
				listener({ presence: structuredClone(presence), reason })
			} catch (error) {
				options.domain.store.logger.error(
					`🐞`,
					`unknown`,
					presence.session,
					`A Mosaic Domain presence cleanup listener threw.`,
					error,
				)
			}
		}
	}

	const clearOwned = (
		actor: string,
		session: string,
		reason: MosaicDomainPresenceCleanup[`reason`],
	): number => {
		const sessionKey = identityKey(actor, session)
		const state = sessions.get(sessionKey)
		if (state === undefined) return 0
		let cleared = 0
		for (const [key, current] of [...live]) {
			if (current.owner !== sessionKey) continue
			clearEntry(key, current, state, reason)
			cleared++
		}
		return cleared
	}

	const sweepExpiredNow = (): number => {
		const timestamp = now()
		let cleared = 0
		for (const [key, current] of [...live]) {
			if (
				(current.envelope.expiresAt ?? Number.POSITIVE_INFINITY) <= timestamp
			) {
				const state = sessions.get(current.owner)
				if (state !== undefined) {
					clearEntry(key, current, state, `expired`)
					cleared++
				}
			}
		}
		return cleared
	}

	const timer = setInterval(
		() => {
			if (disposed) return
			void enqueue(() => sweepExpiredNow())
		},
		Math.max(10, Math.min(ttlMs, 1_000)),
	)
	if (`unref` in timer) timer.unref()

	function enqueue<Value>(work: () => Value | Promise<Value>): Promise<Value> {
		const result = tail.then(work, work)
		tail = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}

	const process = async (
		proposal: MosaicDomainPresenceProposal,
		actor: string,
		session: string,
		state: SessionState,
	): Promise<MosaicDomainPresenceResult> => {
		if (disposed) {
			return rejection(
				`unauthorized`,
				`This Mosaic Domain presence server is disposed.`,
				Number.isSafeInteger(proposal?.sequence) ? proposal.sequence : null,
				`discard-update`,
			)
		}
		try {
			assertMosaicDomainPresenceProposal(proposal, limits)
		} catch (error) {
			const reason = error instanceof Error ? error.message : `Invalid presence.`
			return rejection(
				reason.includes(`protocol version`)
					? `incompatible-version`
					: `invalid-payload`,
				reason,
				Number.isSafeInteger(proposal?.sequence) ? proposal.sequence : null,
				reason.includes(`protocol version`) ? `upgrade` : `discard-update`,
			)
		}
		if (proposal.session !== session) {
			return rejection(
				`unauthorized`,
				`Presence session does not match the authenticated connection.`,
				proposal.sequence,
				`discard-update`,
			)
		}
		try {
			if (
				packCanonical(proposal.domain as unknown as Canonical) !==
				packCanonical(options.domain.identity as unknown as Canonical)
			) {
				throw new Error(`Presence Domain identity does not match this server.`)
			}
		} catch (error) {
			return rejection(
				`invalid-payload`,
				error instanceof Error ? error.message : `Presence Domain is invalid.`,
				proposal.sequence,
				`discard-update`,
			)
		}
		if (proposal.sequence <= state.sequence) {
			return rejection(
				`stale`,
				`Presence sequence ${proposal.sequence} is not newer than ${state.sequence}.`,
				state.sequence,
				`retry`,
			)
		}
		let parsed: Awaited<ReturnType<typeof options.domain.parseAddress>>
		try {
			parsed = await options.domain.parseAddress(proposal.address)
		} catch (error) {
			return rejection(
				`invalid-payload`,
				error instanceof Error ? error.message : `Presence address is invalid.`,
				proposal.sequence,
				`discard-update`,
			)
		}
		if (parsed.member.role !== `ephemeral`) {
			return rejection(
				`unauthorized`,
				`Mosaic Domain member "${parsed.address.member}" is not ephemeral.`,
				proposal.sequence,
				`discard-update`,
			)
		}
		const addressKey = mosaicDomainMemberAddressKey(parsed.address)
		const owner = identityKey(actor, session)
		const currentOwner = slots.get(addressKey)
		if (currentOwner !== undefined && currentOwner !== owner) {
			return rejection(
				`capacity-exceeded`,
				`This ephemeral Domain member is held by another actor-session.`,
				proposal.sequence,
				`retry`,
			)
		}
		let value: Json.Serializable | undefined
		if (proposal.kind === `update`) {
			try {
				value = (await options.domain.validateValue(
					parsed.address.member,
					proposal.value,
				)) as Json.Serializable
			} catch (error) {
				return rejection(
					`invalid-payload`,
					error instanceof Error ? error.message : `Presence value is invalid.`,
					proposal.sequence,
					`discard-update`,
				)
			}
		}
		if (disposed) {
			return rejection(
				`unauthorized`,
				`This Mosaic Domain presence server is disposed.`,
				proposal.sequence,
				`discard-update`,
			)
		}
		state.sequence = proposal.sequence
		const envelope: MosaicDomainPresenceEnvelope = {
			actor,
			address: structuredClone(parsed.address),
			domain: structuredClone(options.domain.identity),
			expiresAt: proposal.kind === `update` ? now() + ttlMs : null,
			kind: proposal.kind,
			protocolVersion: proposal.protocolVersion,
			sequence: proposal.sequence,
			session,
			...(proposal.kind === `update` ? { value: structuredClone(value!) } : {}),
		}
		const key = presenceKey(envelope)
		if (proposal.kind === `clear`) {
			live.delete(key)
			if (slots.get(addressKey) === owner) slots.delete(addressKey)
		} else {
			live.set(key, { envelope, owner })
			slots.set(addressKey, owner)
		}
		broadcast(envelope)
		return { accepted: structuredClone(envelope), status: `accepted` }
	}

	return {
		connect({ actor, session }) {
			if (disposed)
				throw new Error(`This Mosaic Domain presence server is disposed.`)
			if (!identifier(actor) || !identifier(session)) {
				throw new Error(`Presence connections require actor and session IDs.`)
			}
			const key = identityKey(actor, session)
			let state = sessions.get(key)
			if (state?.active === true) {
				throw new Error(`Presence session "${session}" is already connected.`)
			}
			if (state === undefined) {
				if (sessions.size >= limits.maxSessions) {
					throw new Error(
						`Mosaic Domain presence session capacity is exhausted.`,
					)
				}
				state = { active: true, count: 0, sequence: 0, windowStartedAt: now() }
				sessions.set(key, state)
			} else {
				state.active = true
				state.count = 0
				state.windowStartedAt = now()
			}
			let connected = true
			const connectionListeners = new Set<
				(presence: MosaicDomainPresenceEnvelope) => void
			>()
			const relay = (presence: MosaicDomainPresenceEnvelope): void => {
				for (const listener of connectionListeners) {
					try {
						listener(presence)
					} catch (error) {
						options.domain.store.logger.error(
							`🐞`,
							`unknown`,
							session,
							`A Mosaic Domain presence connection listener threw.`,
							error,
						)
					}
				}
			}
			listeners.add(relay)
			return {
				async disconnect() {
					if (!connected) return
					connected = false
					listeners.delete(relay)
					connectionListeners.clear()
					await enqueue(() => {
						state.active = false
						clearOwned(actor, session, `disconnect`)
					})
				},
				async publish(proposal) {
					if (!connected || disposed) {
						return rejection(
							`unauthorized`,
							`Presence connection is closed.`,
							Number.isSafeInteger(proposal?.sequence)
								? proposal.sequence
								: null,
							`discard-update`,
						)
					}
					try {
						assertMosaicDomainPresenceProposal(proposal, limits)
					} catch (error) {
						const reason =
							error instanceof Error ? error.message : `Presence is invalid.`
						const incompatible = reason.includes(`protocol version`)
						return rejection(
							incompatible ? `incompatible-version` : `invalid-payload`,
							reason,
							Number.isSafeInteger(proposal?.sequence)
								? proposal.sequence
								: null,
							incompatible ? `upgrade` : `discard-update`,
						)
					}
					const timestamp = now()
					if (timestamp - state.windowStartedAt >= 1_000) {
						state.windowStartedAt = timestamp
						state.count = 0
					}
					if (state.count >= limits.maxUpdatesPerSecond) {
						return rejection(
							`rate-limited`,
							`Presence update rate exceeds ${limits.maxUpdatesPerSecond} per second.`,
							Number.isSafeInteger(proposal?.sequence)
								? proposal.sequence
								: null,
							`retry`,
						)
					}
					if (pending >= limits.maxPendingUpdates) {
						return rejection(
							`backpressure`,
							`Presence update queue is full.`,
							Number.isSafeInteger(proposal?.sequence)
								? proposal.sequence
								: null,
							`retry`,
						)
					}
					let received: MosaicDomainPresenceProposal
					try {
						received = structuredClone(proposal)
					} catch (error) {
						return rejection(
							`invalid-payload`,
							error instanceof Error
								? error.message
								: `Presence is not cloneable.`,
							null,
							`discard-update`,
						)
					}
					state.count++
					pending++
					try {
						return await enqueue(() => process(received, actor, session, state))
					} finally {
						pending--
					}
				},
				async snapshot() {
					if (!connected || disposed) {
						throw new Error(`Presence connection is closed.`)
					}
					return enqueue(() => {
						if (disposed) {
							throw new Error(`Presence connection is closed.`)
						}
						sweepExpiredNow()
						return {
							presence: [...live.values()].map(({ envelope }) =>
								structuredClone(envelope),
							),
							sequence: state.sequence,
						}
					})
				},
				subscribe(listener) {
					connectionListeners.add(listener)
					return () => connectionListeners.delete(listener)
				},
			}
		},
		forgetSession(actor, session) {
			const key = identityKey(actor, session)
			const state = sessions.get(key)
			if (state === undefined || state.active) return false
			if ([...live.values()].some(({ owner }) => owner === key)) return false
			return sessions.delete(key)
		},
		subscribeCleanup(listener) {
			cleanupListeners.add(listener)
			return () => cleanupListeners.delete(listener)
		},
		sweepExpired() {
			return enqueue(sweepExpiredNow)
		},
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			clearInterval(timer)
			for (const [key, state] of sessions) {
				if (!state.active) continue
				const separator = key.indexOf(`\u0000`)
				state.active = false
				clearOwned(
					key.slice(0, separator),
					key.slice(separator + 1),
					`disconnect`,
				)
			}
			listeners.clear()
			cleanupListeners.clear()
			slots.clear()
		},
	}
}
