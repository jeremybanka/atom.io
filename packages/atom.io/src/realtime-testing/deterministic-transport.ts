import type { Json } from "atom.io/foundations/json"
import type { Socket } from "atom.io/realtime"

import { VirtualClock } from "./virtual-clock"

export type DeterministicTransportMode = `automatic` | `manual`
export type TransportEndpointRole = `client` | `peer` | `server`
export type TransportDirection =
	| `client-to-server`
	| `peer-to-peer`
	| `server-to-client`

export type TransportEndpoint = {
	readonly id: string
	readonly role: TransportEndpointRole
	readonly session: string
}

export type TransportEnvelope = {
	readonly args: readonly Json.Serializable[]
	readonly createdAt: number
	readonly direction: TransportDirection
	readonly event: string
	readonly id: number
	readonly source: TransportEndpoint
	readonly target: TransportEndpoint
}

export type EnvelopeFilter = {
	readonly direction?: TransportDirection
	readonly event?: string | readonly string[]
	readonly from?: string | readonly string[]
	readonly predicate?: (envelope: TransportEnvelope) => boolean
	readonly session?: string | readonly string[]
	readonly to?: string | readonly string[]
}

export type FaultEffect =
	| { readonly type: `delay`; readonly by: number }
	| {
			readonly copies?: number
			readonly spacing?: number
			readonly type: `duplicate`
	  }
	| { readonly type: `drop` }
	| { readonly type: `partition` }
	| { readonly type: `reorder`; readonly window: number }

export type FaultPolicy = {
	readonly chance?: number
	readonly effect: FaultEffect
	readonly filter?: EnvelopeFilter
	readonly name?: string
}

export type DeliveryOutcome = {
	readonly delays: readonly number[]
	readonly disposition: `deliver` | `drop` | `partition`
	readonly reasons: readonly string[]
	readonly reorderBucket: string | null
	readonly reorderWindow: number | null
}

export type ScheduleDecision = {
	readonly envelope: Pick<
		TransportEnvelope,
		`args` | `createdAt` | `direction` | `event` | `id` | `source` | `target`
	>
	readonly outcome: DeliveryOutcome
}

/** A JSON-serializable record that can replay resolved network decisions. */
export type TransportSchedule = {
	readonly decisions: readonly ScheduleDecision[]
	readonly seed: number
	readonly version: 1
}

export type PendingDelivery = {
	readonly copy: number
	readonly dueAt: number
	readonly envelope: TransportEnvelope
	readonly id: number
	/** The current queue order, or null while held for reordering. */
	readonly order: number | null
	readonly state: `held` | `queued` | `scheduled`
}

export type DeterministicTransportOptions = {
	readonly clock?: VirtualClock
	readonly mode?: DeterministicTransportMode
	readonly policies?: readonly FaultPolicy[]
	readonly replay?: TransportSchedule
	readonly seed?: number
}

export type DuplexEndpointOptions = {
	readonly id: string
	readonly role: TransportEndpointRole
	readonly session?: string
}

export type DeterministicDuplex = {
	readonly left: DeterministicSocket
	readonly right: DeterministicSocket
}

type Listener = (...args: Json.Serializable[]) => void
type AnyListener = (event: string, ...args: Json.Serializable[]) => void

type MutableDelivery = PendingDelivery & {
	readonly deliver: () => void
	order: number | null
	state: PendingDelivery[`state`]
}

type ReplayCursor = {
	readonly schedule: TransportSchedule
	position: number
}

/** A minimal atom.io Socket implementation backed by deterministic memory. */
export class DeterministicSocket implements Socket {
	public readonly id: string
	public readonly endpoint: TransportEndpoint
	#anyListeners = new Set<AnyListener>()
	#listeners = new Map<string, Set<Listener>>()
	#outgoingListeners = new Set<AnyListener>()
	#route: ((event: string, args: readonly Json.Serializable[]) => void) | null =
		null

	public constructor(endpoint: TransportEndpoint) {
		this.endpoint = endpoint
		this.id = endpoint.id
	}

	public on(event: string, listener: Listener): void {
		let listeners = this.#listeners.get(event)
		if (listeners === undefined) {
			listeners = new Set()
			this.#listeners.set(event, listeners)
		}
		listeners.add(listener)
	}

	public onAny(listener: AnyListener): void {
		this.#anyListeners.add(listener)
	}

	public onAnyOutgoing(listener: AnyListener): void {
		this.#outgoingListeners.add(listener)
	}

	public off(event: string, listener?: Listener): void {
		if (listener === undefined) this.#listeners.delete(event)
		else this.#listeners.get(event)?.delete(listener)
	}

	public offAny(listener: AnyListener): void {
		this.#anyListeners.delete(listener)
	}

	public emit(event: string, ...args: Json.Serializable[]): void {
		for (const listener of [...this.#outgoingListeners]) listener(event, ...args)
		this.#route?.(event, args)
	}

	/** @internal Connect this endpoint to its transport controller. */
	public connect(
		route: (event: string, args: readonly Json.Serializable[]) => void,
	): void {
		this.#route = route
	}

	/** @internal Deliver an incoming transport envelope. */
	public receive(event: string, args: readonly Json.Serializable[]): void {
		for (const listener of [...(this.#listeners.get(event) ?? [])]) {
			listener(...args)
		}
		for (const listener of [...this.#anyListeners]) listener(event, ...args)
	}
}

/**
 * A deterministic, transport-neutral network for realtime protocol tests.
 *
 * Manual mode queues every delivery for explicit selection. Automatic mode
 * immediately delivers zero-delay traffic and uses the virtual clock for delay.
 * Reorder policies hold a window and release it in reverse arrival order.
 */
export class DeterministicTransport {
	public readonly clock: VirtualClock
	public readonly mode: DeterministicTransportMode
	public readonly seed: number
	#decisions: ScheduleDecision[] = []
	#deliveries = new Map<number, MutableDelivery>()
	#nextDeliveryId = 1
	#nextEnvelopeId = 1
	#nextQueueOrder = 1
	#deliveredCount = 0
	#policies: FaultPolicy[]
	#randomState: number
	#reorderBuffers = new Map<string, MutableDelivery[]>()
	#replay: ReplayCursor | null

	public constructor(options: DeterministicTransportOptions = {}) {
		this.clock = options.clock ?? new VirtualClock()
		this.mode = options.mode ?? `automatic`
		this.seed = options.replay?.seed ?? options.seed ?? 0x51_0c_10
		this.#randomState = this.seed || 1
		this.#policies = [...(options.policies ?? [])]
		this.#replay = options.replay
			? { position: 0, schedule: options.replay }
			: null
	}

	/** Create two Socket-compatible endpoints connected only to each other. */
	public createDuplex(
		leftOptions: DuplexEndpointOptions,
		rightOptions: DuplexEndpointOptions,
	): DeterministicDuplex {
		const left = new DeterministicSocket(this.#endpoint(leftOptions))
		const right = new DeterministicSocket(this.#endpoint(rightOptions))
		left.connect((event, args) => {
			this.#emit(left, right, event, args)
		})
		right.connect((event, args) => {
			this.#emit(right, left, event, args)
		})
		return { left, right }
	}

	/** Install a fault policy. The disposer removes only this occurrence. */
	public use(policy: FaultPolicy): () => void {
		this.#policies.push(policy)
		return () => {
			const index = this.#policies.indexOf(policy)
			if (index >= 0) this.#policies.splice(index, 1)
		}
	}

	/** Inspect outstanding traffic in deterministic delivery order. */
	public pending(): readonly PendingDelivery[] {
		return [...this.#deliveries.values()]
			.sort(
				(left, right) =>
					left.dueAt - right.dueAt ||
					(left.order ?? Number.MAX_SAFE_INTEGER) -
						(right.order ?? Number.MAX_SAFE_INTEGER) ||
					left.id - right.id,
			)
			.map(({ copy, dueAt, envelope, id, order, state }) => ({
				copy,
				dueAt,
				envelope,
				id,
				order,
				state,
			}))
	}

	/** Deliver one due queued envelope in manual mode. */
	public deliverNext(filter?: EnvelopeFilter): PendingDelivery | null {
		const next = [...this.#deliveries.values()]
			.filter(
				(delivery) =>
					delivery.state === `queued` &&
					delivery.dueAt <= this.clock.now() &&
					this.#matches(delivery.envelope, filter),
			)
			.sort(
				(left, right) =>
					(left.order ?? Number.MAX_SAFE_INTEGER) -
						(right.order ?? Number.MAX_SAFE_INTEGER) || left.id - right.id,
			)[0]
		if (next === undefined) return null
		const snapshot = this.#snapshot(next)
		next.deliver()
		return snapshot
	}

	/** Deliver all currently due queued envelopes in manual mode. */
	public deliverDue(filter?: EnvelopeFilter): number {
		let delivered = 0
		while (this.deliverNext(filter) !== null) delivered++
		return delivered
	}

	/** Release incomplete reorder windows, retaining their reverse ordering. */
	public flushReordering(): void {
		for (const [bucket, deliveries] of this.#reorderBuffers) {
			this.#reorderBuffers.delete(bucket)
			this.#releaseReordered(deliveries)
		}
	}

	/**
	 * Drain all transport and clock work, advancing virtual time as necessary.
	 */
	public runUntilIdle(maxDeliveries = 10_000): number {
		let delivered = 0
		while (this.#deliveries.size > 0) {
			// Delivery callbacks can emit more envelopes and open a new, incomplete
			// reorder window. Draining makes those held envelopes deliverable too.
			const beforeFlush = this.#deliveredCount
			this.flushReordering()
			delivered += this.#deliveredCount - beforeFlush
			if (this.#deliveries.size === 0) break
			if (delivered >= maxDeliveries) {
				throw new Error(
					`DeterministicTransport exceeded its ${maxDeliveries}-delivery safety limit; pending: ${JSON.stringify(this.pending())}`,
				)
			}
			if (this.mode === `automatic`) {
				const before = this.#deliveredCount
				this.clock.runUntilIdle(maxDeliveries - delivered)
				delivered += this.#deliveredCount - before
				continue
			}
			const next = this.pending()[0]
			if (next === undefined) break
			if (next.dueAt > this.clock.now()) this.clock.advanceTo(next.dueAt)
			delivered += this.deliverDue()
		}
		return delivered
	}

	/** Export all resolved fault decisions as replayable JSON data. */
	public exportSchedule(): TransportSchedule {
		return { decisions: this.#decisions, seed: this.seed, version: 1 }
	}

	/** Assert that every decision supplied for replay was consumed. */
	public assertReplayComplete(): void {
		if (
			this.#replay !== null &&
			this.#replay.position !== this.#replay.schedule.decisions.length
		) {
			throw new Error(
				`Transport replay consumed ${this.#replay.position}/${this.#replay.schedule.decisions.length} decisions`,
			)
		}
	}

	#emit(
		source: DeterministicSocket,
		target: DeterministicSocket,
		event: string,
		args: readonly Json.Serializable[],
	): void {
		const envelope: TransportEnvelope = {
			args: structuredClone(args),
			createdAt: this.clock.now(),
			direction: this.#direction(source.endpoint.role, target.endpoint.role),
			event,
			id: this.#nextEnvelopeId++,
			source: source.endpoint,
			target: target.endpoint,
		}
		const outcome = this.#resolveOutcome(envelope)
		this.#decisions.push({ envelope: this.#signature(envelope), outcome })
		if (outcome.disposition !== `deliver`) return

		for (const [copy, delay] of outcome.delays.entries()) {
			const delivery: MutableDelivery = {
				copy,
				deliver: () => {
					if (!this.#deliveries.delete(delivery.id)) return
					this.#deliveredCount++
					target.receive(envelope.event, structuredClone(envelope.args))
				},
				dueAt: envelope.createdAt + delay,
				envelope,
				id: this.#nextDeliveryId++,
				order: null,
				state: outcome.reorderWindow === null ? `queued` : `held`,
			}
			this.#deliveries.set(delivery.id, delivery)
			if (outcome.reorderWindow === null) this.#release(delivery)
			else {
				this.#holdForReordering(
					outcome.reorderBucket ?? `reorder:${outcome.reorderWindow}`,
					outcome.reorderWindow,
					delivery,
				)
			}
		}
	}

	#resolveOutcome(envelope: TransportEnvelope): DeliveryOutcome {
		const replayed = this.#replay?.schedule.decisions[this.#replay.position]
		if (this.#replay !== null) {
			if (replayed === undefined) {
				throw new Error(
					`Transport replay has no decision for envelope ${envelope.id}`,
				)
			}
			const signature = this.#signature(envelope)
			if (JSON.stringify(replayed.envelope) !== JSON.stringify(signature)) {
				throw new Error(
					`Transport replay mismatch at decision ${this.#replay.position}: expected ${JSON.stringify(replayed.envelope)}, received ${JSON.stringify(signature)}`,
				)
			}
			this.#replay.position++
			return replayed.outcome
		}

		let delays = [0]
		let disposition: DeliveryOutcome[`disposition`] = `deliver`
		let reorderBucket: string | null = null
		let reorderWindow: number | null = null
		const reasons: string[] = []
		for (const [index, policy] of this.#policies.entries()) {
			if (!this.#matches(envelope, policy.filter)) continue
			if (policy.chance !== undefined) {
				if (policy.chance < 0 || policy.chance > 1) {
					throw new Error(`Fault policy chance must be between 0 and 1`)
				}
				if (this.#random() >= policy.chance) continue
			}
			const name = policy.name ?? `policy-${index + 1}`
			reasons.push(name)
			switch (policy.effect.type) {
				case `delay`: {
					const { by } = policy.effect
					this.#assertNonNegative(by, `delay`)
					delays = delays.map((delay) => delay + by)
					break
				}
				case `duplicate`: {
					const copies = policy.effect.copies ?? 2
					const spacing = policy.effect.spacing ?? 0
					if (!Number.isInteger(copies) || copies < 2) {
						throw new Error(`Duplicate copies must be an integer of at least 2`)
					}
					this.#assertNonNegative(spacing, `duplicate spacing`)
					delays = delays.flatMap((delay) =>
						Array.from({ length: copies }, (_, copy) => delay + copy * spacing),
					)
					break
				}
				case `drop`:
					disposition = `drop`
					break
				case `partition`:
					disposition = `partition`
					break
				case `reorder`:
					if (
						!Number.isInteger(policy.effect.window) ||
						policy.effect.window < 2
					) {
						throw new Error(`Reorder window must be an integer of at least 2`)
					}
					reorderWindow = policy.effect.window
					reorderBucket = `${index}:${name}:${policy.effect.window}`
					break
			}
			if (disposition !== `deliver`) break
		}
		return {
			delays,
			disposition,
			reasons,
			reorderBucket,
			reorderWindow,
		}
	}

	#holdForReordering(
		bucket: string,
		window: number,
		delivery: MutableDelivery,
	): void {
		const buffer = this.#reorderBuffers.get(bucket) ?? []
		buffer.push(delivery)
		this.#reorderBuffers.set(bucket, buffer)
		if (buffer.length < window) return
		this.#reorderBuffers.delete(bucket)
		this.#releaseReordered(buffer)
	}

	#releaseReordered(deliveries: MutableDelivery[]): void {
		for (const delivery of deliveries.reverse()) this.#release(delivery)
	}

	#release(delivery: MutableDelivery): void {
		delivery.order = this.#nextQueueOrder++
		if (this.mode === `manual`) {
			delivery.state = `queued`
			return
		}
		delivery.state = `scheduled`
		const delay = Math.max(0, delivery.dueAt - this.clock.now())
		this.clock.schedule(
			delivery.deliver,
			delay,
			`transport:${delivery.envelope.event}#${delivery.envelope.id}.${delivery.copy}`,
		)
		if (delay === 0) this.clock.advance(0)
	}

	#matches(envelope: TransportEnvelope, filter?: EnvelopeFilter): boolean {
		if (filter === undefined) return true
		return (
			this.#includes(filter.direction, envelope.direction) &&
			this.#includes(filter.event, envelope.event) &&
			this.#includes(filter.from, envelope.source.id) &&
			this.#includes(filter.to, envelope.target.id) &&
			(filter.session === undefined ||
				this.#includes(filter.session, envelope.source.session) ||
				this.#includes(filter.session, envelope.target.session)) &&
			(filter.predicate?.(envelope) ?? true)
		)
	}

	#includes(
		expected: string | readonly string[] | undefined,
		actual: string,
	): boolean {
		return expected === undefined
			? true
			: typeof expected === `string`
				? expected === actual
				: expected.includes(actual)
	}

	#endpoint(options: DuplexEndpointOptions): TransportEndpoint {
		return {
			id: options.id,
			role: options.role,
			session: options.session ?? options.id,
		}
	}

	#direction(
		source: TransportEndpointRole,
		target: TransportEndpointRole,
	): TransportDirection {
		if (source === `client` && target === `server`) return `client-to-server`
		if (source === `server` && target === `client`) return `server-to-client`
		return `peer-to-peer`
	}

	#signature(envelope: TransportEnvelope): ScheduleDecision[`envelope`] {
		return {
			args: envelope.args,
			createdAt: envelope.createdAt,
			direction: envelope.direction,
			event: envelope.event,
			id: envelope.id,
			source: envelope.source,
			target: envelope.target,
		}
	}

	#snapshot(delivery: MutableDelivery): PendingDelivery {
		return {
			copy: delivery.copy,
			dueAt: delivery.dueAt,
			envelope: delivery.envelope,
			id: delivery.id,
			order: delivery.order,
			state: delivery.state,
		}
	}

	#random(): number {
		let value = this.#randomState | 0
		value ^= value << 13
		value ^= value >>> 17
		value ^= value << 5
		this.#randomState = value >>> 0
		return this.#randomState / 0x1_00_00_00_00
	}

	#assertNonNegative(value: number, name: string): void {
		if (!Number.isFinite(value) || value < 0) {
			throw new Error(`Fault policy ${name} must be finite and non-negative`)
		}
	}
}

/** Create a deterministic in-memory network without affecting Socket.IO tests. */
export const createDeterministicTransport = (
	options?: DeterministicTransportOptions,
): DeterministicTransport => new DeterministicTransport(options)
