import { type Canonical, packCanonical } from "atom.io/foundations/canonical"
import { disposeFromStore, setIntoStore } from "atom.io/internal"
import {
	assertMosaicDomainPresenceProposal,
	DEFAULT_MOSAIC_DOMAIN_PRESENCE_LIMITS,
	MOSAIC_DOMAIN_PRESENCE_PROTOCOL_VERSION,
	type MosaicDomainInstance,
	type MosaicDomainMemberAddress,
	mosaicDomainMemberAddressKey,
	type MosaicDomainPresenceEnvelope,
	type MosaicDomainPresenceProposal,
	type MosaicDomainPresenceRejection,
	type MosaicDomainPresenceResult,
	type MosaicDomainPresenceSnapshot,
} from "atom.io/realtime"

export type MosaicDomainPresenceClientTransport = {
	publish(
		proposal: MosaicDomainPresenceProposal,
	): Promise<MosaicDomainPresenceResult>
	snapshot(): Promise<MosaicDomainPresenceSnapshot>
	subscribe(
		listener: (presence: MosaicDomainPresenceEnvelope) => void,
	): () => void
}

export type MosaicDomainPresenceClientState = {
	readonly pending: number
	readonly presence: readonly MosaicDomainPresenceEnvelope[]
	readonly problem: MosaicDomainPresenceRejection | null
	readonly status: `connecting` | `disposed` | `live` | `offline` | `rejected`
}

export type MosaicDomainPresenceClientOptions = {
	readonly domain: MosaicDomainInstance<any, any, any>
	readonly maxBytes?: number
	readonly maxPendingUpdates?: number
	readonly session: string
	readonly transport: MosaicDomainPresenceClientTransport
}

export type MosaicDomainPresenceClient = Disposable & {
	clear(address: MosaicDomainMemberAddress): Promise<void>
	flush(): Promise<void>
	publish(address: MosaicDomainMemberAddress, value: unknown): Promise<void>
	refresh(): Promise<void>
	readonly state: MosaicDomainPresenceClientState
	start(): Promise<void>
	subscribe(
		listener: (state: MosaicDomainPresenceClientState) => void,
	): () => void
}

const scopeKey = (presence: {
	readonly actor: string
	readonly address: MosaicDomainMemberAddress
	readonly session: string
}): string =>
	`${presence.actor}\u0000${presence.session}\u0000${mosaicDomainMemberAddressKey(presence.address)}`

/**
 * Project authenticated ephemeral envelopes into ordinary Domain members.
 * This controller owns no durable history and never enters an Atom.io timeline.
 */
export function createMosaicDomainPresenceClient(
	options: MosaicDomainPresenceClientOptions,
): MosaicDomainPresenceClient {
	const maxPending = options.maxPendingUpdates ?? 64
	const maxBytes =
		options.maxBytes ?? DEFAULT_MOSAIC_DOMAIN_PRESENCE_LIMITS.maxBytes
	if (
		!Number.isSafeInteger(maxPending) ||
		maxPending < 1 ||
		!Number.isSafeInteger(maxBytes) ||
		maxBytes < 1
	) {
		throw new Error(`Presence limits must be positive integers.`)
	}
	const entries = new Map<string, MosaicDomainPresenceEnvelope>()
	const projections = new Map<
		string,
		{ readonly addressKey: string; readonly token: unknown }
	>()
	const cursors = new Map<string, number>()
	const listeners = new Set<(state: MosaicDomainPresenceClientState) => void>()
	let sequence = 0
	let pending = 0
	let problem: MosaicDomainPresenceClientState[`problem`] = null
	let status: MosaicDomainPresenceClientState[`status`] = `connecting`
	let disposed = false
	let started = false
	let queue = Promise.resolve()

	const snapshot = (): MosaicDomainPresenceClientState =>
		Object.freeze({
			pending,
			presence: Object.freeze(
				[...entries.values()].map((entry) =>
					Object.freeze(structuredClone(entry)),
				),
			),
			problem,
			status,
		})

	const notify = (): void => {
		const state = snapshot()
		for (const listener of listeners) {
			try {
				listener(state)
			} catch (error) {
				options.domain.store.logger.error(
					`🐞`,
					`unknown`,
					options.session,
					`A Mosaic Domain presence client listener threw.`,
					error,
				)
			}
		}
	}

	const enqueue = <Value>(work: () => Promise<Value>): Promise<Value> => {
		const result = queue.then(work, work)
		queue = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}

	const apply = async (
		presence: MosaicDomainPresenceEnvelope,
	): Promise<string | null> => {
		if (disposed) return null
		if (
			typeof presence.actor !== `string` ||
			presence.actor.length === 0 ||
			typeof presence.session !== `string` ||
			presence.session.length === 0 ||
			!Number.isSafeInteger(presence.sequence) ||
			presence.sequence < 1 ||
			(presence.kind !== `update` && presence.kind !== `clear`)
		) {
			throw new Error(`The presence transport delivered an invalid envelope.`)
		}
		const { actor: _actor, expiresAt, ...proposal } = presence
		assertMosaicDomainPresenceProposal(proposal, { maxBytes })
		if (
			(presence.kind === `update`
				? expiresAt === null || !Number.isSafeInteger(expiresAt) || expiresAt < 0
				: expiresAt !== null) ||
			packCanonical(presence.domain as unknown as Canonical) !==
				packCanonical(options.domain.identity as unknown as Canonical)
		) {
			throw new Error(`The presence transport delivered an invalid envelope.`)
		}
		const parsed = await options.domain.parseAddress(presence.address)
		if (disposed) return null
		if (parsed.member.role !== `ephemeral`) {
			throw new Error(
				`Mosaic Domain member "${parsed.address.member}" is not ephemeral.`,
			)
		}
		const key = scopeKey({ ...presence, address: parsed.address })
		if (presence.sequence <= (cursors.get(key) ?? 0)) return key
		if (presence.session === options.session) {
			sequence = Math.max(sequence, presence.sequence)
		}
		const acquired = await options.domain.acquire(parsed)
		if (disposed) return null
		if (presence.kind === `update`) {
			const value = await options.domain.validateValue(
				parsed.address.member,
				presence.value,
			)
			if (disposed) return null
			const addressKey = mosaicDomainMemberAddressKey(parsed.address)
			for (const [otherKey, projection] of projections) {
				if (otherKey === key || projection.addressKey !== addressKey) continue
				projections.delete(otherKey)
				entries.delete(otherKey)
			}
			setIntoStore(options.domain.store, acquired.token as never, value)
			projections.set(key, { addressKey, token: acquired.token })
			entries.set(key, {
				...structuredClone(presence),
				address: structuredClone(parsed.address),
				value: structuredClone(value),
			})
		} else {
			const projected = projections.get(key)?.token
			if (projected !== undefined) {
				disposeFromStore(options.domain.store, projected as never)
			}
			projections.delete(key)
			entries.delete(key)
		}
		cursors.set(key, presence.sequence)
		notify()
		return key
	}

	const reconcile = async (
		initial: MosaicDomainPresenceSnapshot,
	): Promise<void> => {
		if (disposed) return
		if (
			!Number.isSafeInteger(initial.sequence) ||
			initial.sequence < 0 ||
			!Array.isArray(initial.presence)
		) {
			throw new Error(`The presence transport returned an invalid snapshot.`)
		}
		sequence = Math.max(sequence, initial.sequence)
		const received = new Set<string>()
		for (const presence of initial.presence) {
			if (disposed) return
			const key = await apply(presence)
			if (key !== null) received.add(key)
		}
		for (const key of [...entries.keys()]) {
			if (disposed) return
			if (received.has(key)) continue
			const token = projections.get(key)?.token
			if (token !== undefined) {
				disposeFromStore(options.domain.store, token as never)
				projections.delete(key)
			}
			entries.delete(key)
		}
		status = `live`
		problem = null
		notify()
	}

	const refresh = async (): Promise<void> => {
		try {
			const initial = await options.transport.snapshot()
			await enqueue(() => reconcile(initial))
		} catch (error) {
			if (!disposed) {
				status = `offline`
				notify()
			}
			throw error
		}
	}

	const publish = async (
		proposal: MosaicDomainPresenceProposal,
	): Promise<MosaicDomainPresenceResult> => {
		try {
			return await options.transport.publish(proposal)
		} catch (error) {
			if (!disposed) {
				status = `offline`
				notify()
			}
			throw error
		}
	}

	const unsubscribe = options.transport.subscribe((presence) => {
		void enqueue(async () => {
			try {
				await apply(structuredClone(presence))
			} catch (error) {
				status = `rejected`
				problem = {
					code: `invalid-payload`,
					reason:
						error instanceof Error
							? error.message
							: `Presence envelope is invalid.`,
					recovery: `discard-update`,
					sequence: Number.isSafeInteger(presence?.sequence)
						? presence.sequence
						: null,
				}
				notify()
			}
		})
	})

	const send = async (
		address: MosaicDomainMemberAddress,
		kind: MosaicDomainPresenceProposal[`kind`],
		value?: unknown,
	): Promise<void> => {
		if (disposed)
			throw new Error(`This Mosaic Domain presence client is disposed.`)
		if (!started) await controller.start()
		if (pending >= maxPending) {
			throw new Error(`Mosaic Domain presence client queue is full.`)
		}
		pending++
		notify()
		try {
			const parsed = await options.domain.parseAddress(address)
			if (disposed) return
			if (parsed.member.role !== `ephemeral`) {
				throw new Error(
					`Mosaic Domain member "${parsed.address.member}" is not ephemeral.`,
				)
			}
			const validatedValue =
				kind === `update`
					? structuredClone(
							await options.domain.validateValue(parsed.address.member, value),
						)
					: undefined
			if (disposed) return
			let proposal: MosaicDomainPresenceProposal = {
				address: structuredClone(parsed.address),
				domain: structuredClone(options.domain.identity),
				kind,
				protocolVersion: MOSAIC_DOMAIN_PRESENCE_PROTOCOL_VERSION,
				sequence: ++sequence,
				session: options.session,
				...(kind === `update` ? { value: validatedValue! } : {}),
			}
			let result = await publish(proposal)
			if (disposed) return
			if (result.status === `rejected` && result.rejection.code === `stale`) {
				sequence = Math.max(sequence, result.rejection.sequence ?? 0)
				await refresh()
				if (disposed) return
				proposal = { ...proposal, sequence: ++sequence }
				result = await publish(proposal)
				if (disposed) return
			}
			if (result.status === `rejected`) {
				problem = result.rejection
				status = `rejected`
				notify()
				throw new Error(result.rejection.reason)
			}
			await enqueue(() => apply(result.accepted))
			if (disposed) return
			problem = null
			status = `live`
		} finally {
			pending--
			notify()
		}
	}

	const controller: MosaicDomainPresenceClient = {
		clear: (address) => send(address, `clear`),
		async flush() {
			await queue
		},
		publish: (address, value) => send(address, `update`, value),
		refresh,
		get state() {
			return snapshot()
		},
		async start() {
			if (disposed)
				throw new Error(`This Mosaic Domain presence client is disposed.`)
			if (started) return queue
			started = true
			try {
				await refresh()
			} catch (error) {
				started = false
				throw error
			}
		},
		subscribe(listener) {
			listeners.add(listener)
			try {
				listener(snapshot())
			} catch (error) {
				options.domain.store.logger.error(
					`🐞`,
					`unknown`,
					options.session,
					`A Mosaic Domain presence client listener threw.`,
					error,
				)
			}
			return () => listeners.delete(listener)
		},
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			status = `disposed`
			unsubscribe()
			for (const projectionToken of new Set(
				[...projections.values()].map((projection) => projection.token),
			)) {
				disposeFromStore(options.domain.store, projectionToken as never)
			}
			projections.clear()
			entries.clear()
			listeners.clear()
		},
	}
	return controller
}
