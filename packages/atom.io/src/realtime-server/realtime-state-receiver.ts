import type { WritableToken } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import {
	findInStore,
	IMPLICIT,
	setIntoStore,
	type Store,
} from "atom.io/internal"
import type {
	RealtimeLeaseStatus,
	Socket,
	StandardSchemaV1,
} from "atom.io/realtime"
import { employSocket, mutexAtoms } from "atom.io/realtime"

import type { ServerConfig } from "."

export type RealtimeLeaseClock = {
	clearTimeout: (timer: unknown) => void
	now: () => number
	setTimeout: (callback: () => void, milliseconds: number) => unknown
}

export type RealtimeStateReceiverOptions = {
	/** How long ownership remains valid without a renewal. Defaults to 10s. */
	leaseDurationMs?: number
	/** Injectable clock used by deterministic tests and alternate runtimes. */
	leaseClock?: RealtimeLeaseClock
	/** Suggested client renewal interval. Defaults to one third of the lease. */
	renewAfterMs?: number
}

export type StateReceiver = <S extends Json.Serializable, C extends S>(
	schema: StandardSchemaV1<unknown, C>,
	clientToken: WritableToken<C>,
	serverToken?: WritableToken<S>,
	options?: RealtimeStateReceiverOptions,
) => () => void

type LeaseReference = { generation: number; leaseId: string }
type PublicationEnvelope = LeaseReference & {
	sequence: number
	value: Json.Serializable
}
type Owner = LeaseReference & {
	expiresAt: number
	publicationTail: Promise<void>
	sequence: number
	socket: Socket
}

const systemClock: RealtimeLeaseClock = {
	clearTimeout: (timer) => {
		clearTimeout(timer as ReturnType<typeof setTimeout>)
	},
	now: Date.now,
	setTimeout,
}

class LeaseCoordinator {
	private readonly clock: RealtimeLeaseClock
	private readonly durationMs: number
	private readonly renewAfterMs: number
	private readonly store: Store
	private readonly tokenKey: string
	private readonly waiters: Socket[] = []
	private readonly eventKeys = new WeakMap<Socket, string>()
	private generation = 0
	private owner: Owner | null = null
	private expiryTimer: unknown

	public constructor(
		store: Store,
		tokenKey: string,
		options: RealtimeStateReceiverOptions,
	) {
		this.store = store
		this.tokenKey = tokenKey
		this.durationMs = options.leaseDurationMs ?? 10_000
		this.renewAfterMs = options.renewAfterMs ?? Math.floor(this.durationMs / 3)
		this.clock = options.leaseClock ?? systemClock
		if (this.durationMs <= 0) throw new Error(`leaseDurationMs must be positive`)
		if (this.renewAfterMs <= 0 || this.renewAfterMs >= this.durationMs) {
			throw new Error(`renewAfterMs must be positive and shorter than the lease`)
		}
	}
	public register(socket: Socket, eventKey: string): void {
		this.eventKeys.set(socket, eventKey)
	}

	public claim(socket: Socket): void {
		if (this.owner?.socket === socket) {
			this.emitOwned(this.owner)
			return
		}
		const existing = this.waiters.indexOf(socket)
		if (existing !== -1) {
			this.emitWaiting(socket, existing)
			return
		}
		if (this.owner === null) {
			this.grant(socket)
			return
		}
		this.waiters.push(socket)
		this.emitWaiting(socket, this.waiters.length - 1)
	}

	public renew(socket: Socket, reference: LeaseReference): void {
		if (!this.isCurrent(socket, reference)) {
			this.emitReleased(socket, reference.generation, `stale`)
			return
		}
		const owner = this.owner
		if (owner === null) return
		owner.expiresAt = this.clock.now() + this.durationMs
		this.scheduleExpiry(owner)
		this.emitOwned(owner)
	}

	public release(
		socket: Socket,
		reference?: LeaseReference,
		reason: `expired` | `released` = `released`,
	): void {
		const waiterIndex = this.waiters.indexOf(socket)
		if (waiterIndex !== -1) {
			this.waiters.splice(waiterIndex, 1)
			this.updateWaiterPositions()
		}
		if (this.owner?.socket !== socket) return
		if (
			reference &&
			(this.owner.generation !== reference.generation ||
				this.owner.leaseId !== reference.leaseId)
		) {
			this.emitReleased(socket, reference.generation, `stale`)
			return
		}
		const former = this.owner
		this.owner = null
		this.clearExpiry()
		this.emitReleased(socket, former.generation, reason)
		if (this.waiters.length > 0) {
			this.grant(this.waiters.shift()!)
		} else {
			setIntoStore(this.store, mutexAtoms, this.tokenKey, false)
		}
		this.updateWaiterPositions()
	}

	public remove(socket: Socket): void {
		this.release(socket)
		this.eventKeys.delete(socket)
	}

	public publish<Value extends Json.Serializable>(
		socket: Socket,
		input: Json.Serializable,
		validate: (
			value: Json.Serializable,
		) => Promise<{ accepted: false } | { accepted: true; value: Value }>,
		apply: (value: Value) => void,
	): void {
		const envelope = this.parsePublication(socket, input)
		if (envelope === null) return
		const owner = this.owner
		if (owner === null) return
		if (envelope.sequence !== owner.sequence + 1) {
			this.emitReleased(socket, envelope.generation, `stale`)
			return
		}
		owner.sequence = envelope.sequence
		const generation = owner.generation
		const leaseId = owner.leaseId
		// Begin validations eagerly, then commit their results in publication order.
		// A fast second validation therefore cannot overtake a slow first one.
		const validated = validate(envelope.value)
		owner.publicationTail = owner.publicationTail.then(async () => {
			const result = await validated
			// Validation may finish after expiry or handoff. Fence immediately before
			// the authoritative write so queued work from a former owner cannot land.
			if (!result.accepted || !this.isCurrent(socket, { generation, leaseId })) {
				return
			}
			apply(result.value)
		})
	}

	private isCurrent(socket: Socket, reference: LeaseReference): boolean {
		return (
			this.owner?.socket === socket &&
			this.owner.generation === reference.generation &&
			this.owner.leaseId === reference.leaseId &&
			this.owner.expiresAt > this.clock.now()
		)
	}

	private grant(socket: Socket): void {
		const generation = ++this.generation
		const leaseId = `${socket.id ?? `socket`}:${generation}`
		const owner: Owner = {
			expiresAt: this.clock.now() + this.durationMs,
			generation,
			leaseId,
			publicationTail: Promise.resolve(),
			sequence: 0,
			socket,
		}
		this.owner = owner
		setIntoStore(this.store, mutexAtoms, this.tokenKey, true)
		this.scheduleExpiry(owner)
		this.emitOwned(owner)
		socket.emit(`claim-result:${this.eventKey(socket)}`, true)
	}

	private scheduleExpiry(owner: Owner): void {
		this.clearExpiry()
		this.expiryTimer = this.clock.setTimeout(
			() => {
				if (this.owner !== owner) return
				const remaining = owner.expiresAt - this.clock.now()
				if (remaining > 0) {
					this.scheduleExpiry(owner)
					return
				}
				this.release(owner.socket, owner, `expired`)
			},
			Math.max(0, owner.expiresAt - this.clock.now()),
		)
	}

	private clearExpiry(): void {
		if (this.expiryTimer !== undefined) this.clock.clearTimeout(this.expiryTimer)
		this.expiryTimer = undefined
	}

	private emitOwned(owner: Owner): void {
		const status: RealtimeLeaseStatus = {
			expiresAt: owner.expiresAt,
			generation: owner.generation,
			leaseId: owner.leaseId,
			renewAfterMs: this.renewAfterMs,
			state: `owned`,
		}
		owner.socket.emit(`lease-status:${this.eventKey(owner.socket)}`, status)
	}

	private emitWaiting(socket: Socket, index: number): void {
		const status: RealtimeLeaseStatus = { position: index + 1, state: `waiting` }
		const eventKey = this.eventKey(socket)
		socket.emit(`lease-status:${eventKey}`, status)
		socket.emit(`claim-result:${eventKey}`, false)
	}

	private emitReleased(
		socket: Socket,
		generation: number,
		reason: `expired` | `released` | `stale`,
	): void {
		const status: RealtimeLeaseStatus = { generation, reason, state: `released` }
		socket.emit(`lease-status:${this.eventKey(socket)}`, status)
	}

	private eventKey(socket: Socket): string {
		return this.eventKeys.get(socket) ?? this.tokenKey
	}

	private updateWaiterPositions(): void {
		this.waiters.forEach((socket, index) => {
			this.emitWaiting(socket, index)
		})
	}

	private parsePublication(
		socket: Socket,
		input: Json.Serializable,
	): PublicationEnvelope | null {
		if (
			typeof input === `object` &&
			input !== null &&
			!Array.isArray(input) &&
			`leaseId` in input &&
			`generation` in input &&
			`sequence` in input &&
			`value` in input
		) {
			const envelope = input as unknown as PublicationEnvelope
			if (!this.isCurrent(socket, envelope)) {
				this.emitReleased(socket, envelope.generation, `stale`)
				return null
			}
			return envelope
		}
		// Older clients publish raw values. Socket ownership still fences these
		// publications, though they do not receive generation-aware diagnostics.
		const owner = this.owner
		if (owner?.socket !== socket || owner.expiresAt <= this.clock.now())
			return null
		return {
			generation: owner.generation,
			leaseId: owner.leaseId,
			sequence: owner.sequence + 1,
			value: input,
		}
	}
}

const coordinators = new WeakMap<Store, Map<string, LeaseCoordinator>>()

function coordinatorFor(
	store: Store,
	tokenKey: string,
	options: RealtimeStateReceiverOptions,
): LeaseCoordinator {
	let byToken = coordinators.get(store)
	if (byToken === undefined) {
		byToken = new Map()
		coordinators.set(store, byToken)
	}
	let coordinator = byToken.get(tokenKey)
	if (coordinator === undefined) {
		coordinator = new LeaseCoordinator(store, tokenKey, options)
		byToken.set(tokenKey, coordinator)
	}
	return coordinator
}

export function realtimeStateReceiver({
	socket,
	consumer,
	store = IMPLICIT.STORE,
}: ServerConfig): StateReceiver {
	return function stateReceiver(
		schema,
		clientToken,
		serverToken = clientToken,
		options = {},
	): () => void {
		const mutexAtom = findInStore(store, mutexAtoms, serverToken.key)
		void mutexAtom // Ensure the compatibility atom exists before the first claim.
		const coordinator = coordinatorFor(store, serverToken.key, options)
		coordinator.register(socket, clientToken.key)

		const subscriptions = [
			employSocket(socket, `claim:${clientToken.key}`, () => {
				coordinator.claim(socket)
			}),
			employSocket(
				socket,
				`renew:${clientToken.key}`,
				(reference: LeaseReference) => {
					coordinator.renew(socket, reference)
				},
			),
			employSocket(
				socket,
				`unclaim:${clientToken.key}`,
				(reference?: Json.Serializable) => {
					coordinator.release(socket, reference as LeaseReference | undefined)
				},
			),
			employSocket(socket, `pub:${clientToken.key}`, (input) => {
				coordinator.publish(
					socket,
					input,
					async (newValue) => {
						const parsed = await schema[`~standard`].validate(newValue)
						if (parsed.issues) {
							store.logger.error(
								`❌`,
								`user`,
								consumer,
								`attempted to publish invalid value`,
								newValue,
								`to state "${serverToken.key}"`,
							)
							return { accepted: false }
						}
						return { accepted: true, value: parsed.value }
					},
					(newValue) => {
						setIntoStore(store, serverToken, newValue)
					},
				)
			}),
		]

		return () => {
			for (const unsubscribe of subscriptions) unsubscribe()
			coordinator.remove(socket)
		}
	}
}
