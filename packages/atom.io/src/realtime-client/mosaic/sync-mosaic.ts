import type {
	MutableAtomToken,
	RegularAtomFamilyToken,
	RegularAtomToken,
} from "atom.io"
import type { Json } from "atom.io/foundations/json"
import type { AsJSON, RootStore, SignalFrom } from "atom.io/internal"
import {
	createRegularAtomFamily,
	disposeFromStore,
	getFromStore,
	getJsonTokenFromStore,
	getUpdateToken,
	newest,
	seekInStore,
	setIntoStore,
	subscribeToState,
	withdraw,
} from "atom.io/internal"
import {
	type AnyMosaicTransceiver,
	MOSAIC_EVENTS,
	MOSAIC_PROTOCOL_VERSION,
	type MosaicAcceptedOperationEnvelope,
	mosaicAtomAddress,
	mosaicAtomAddressKey,
	type MosaicIntent,
	type MosaicJoinEnvelope,
	type MosaicOperation,
	type MosaicOperationEnvelope,
	type MosaicOperationProposal,
	type MosaicPresenceEnvelope,
	type MosaicPresenceProposal,
	type MosaicRejectionEnvelope,
	type MosaicSignal,
	type MosaicSnapshot,
	type MosaicSnapshotEnvelope,
	type MosaicTransceiverConstructor,
} from "atom.io/realtime"

import type {
	MosaicClientClock,
	MosaicClientIdContext,
	MosaicClientIdSource,
	MosaicClientProblem,
	MosaicClientStatus,
	MosaicClientTransport,
	MosaicCompanionAtoms,
	MosaicController,
	MosaicSubmitOptions,
	MosaicSyncOptions,
} from "./types.ts"

const SYSTEM_TIME: MosaicClientClock = { now: () => Date.now() }

const REJECTION_CODES = new Set([
	`atom-unavailable`,
	`capacity-exceeded`,
	`incompatible-version`,
	`invalid-model-operation`,
	`invalid-payload`,
	`missing-dependency`,
	`operation-id-collision`,
	`stale-history`,
	`unauthorized`,
])

const RECOVERIES = new Set([
	`discard-operation`,
	`none`,
	`resnapshot`,
	`retry`,
	`upgrade`,
])

const FAMILY_KEYS = {
	pending: `🔶mosaic:pending`,
	presence: `🔶mosaic:presence`,
	problem: `🔶mosaic:problem`,
	revision: `🔶mosaic:revision`,
	status: `🔶mosaic:status`,
} as const

type CompanionKey = string

type ModelProposal<T extends AnyMosaicTransceiver> = MosaicOperationProposal<
	MosaicOperation<T>
>

function randomId(): string {
	const randomUUID = globalThis.crypto?.randomUUID
	if (randomUUID !== undefined) return randomUUID.call(globalThis.crypto)
	if (globalThis.crypto?.getRandomValues !== undefined) {
		const bytes = globalThis.crypto.getRandomValues(new Uint32Array(4))
		return [...bytes].map((value) => value.toString(36)).join(`-`)
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const defaultIdSource: MosaicClientIdSource = ({
	actor,
	kind,
	now,
	sequence,
	session,
}: MosaicClientIdContext): string => {
	if (kind === `session`) return `${actor}:session:${randomId()}`
	const time = Math.max(0, Math.floor(now)).toString(36).padStart(10, `0`)
	const counter = sequence.toString(36).padStart(8, `0`)
	return `${session}:${kind}:${time}:${counter}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === `object` && value !== null && !Array.isArray(value)

const presenceKey = (actor: string, session: string): string =>
	`${actor}\u0000${session}`

function companionFamily<T>(
	store: RootStore,
	key: string,
	defaultValue: T,
): RegularAtomFamilyToken<T, CompanionKey> {
	const existing = store.families.get(key)
	if (existing !== undefined) {
		if (existing.type !== `atom_family`) {
			throw new Error(`Mosaic companion key \"${key}\" is already in use`)
		}
		return { key, type: `atom_family` }
	}
	return createRegularAtomFamily<T, CompanionKey, never>(store, {
		key,
		default: defaultValue,
	})
}

function companionAtom<T>(
	store: RootStore,
	family: RegularAtomFamilyToken<T, CompanionKey>,
	key: CompanionKey,
): RegularAtomToken<T> {
	const existing = seekInStore(store, family, key)
	if (existing !== undefined) return existing
	return withdraw(store, family).create(key)
}

function createCompanionAtoms<
	T extends AnyMosaicTransceiver,
	Presence extends Json.Serializable,
>(store: RootStore, key: CompanionKey): MosaicCompanionAtoms<T, Presence> {
	return {
		pending: companionAtom(
			store,
			companionFamily(store, FAMILY_KEYS.pending, [] as readonly string[]),
			key,
		),
		presence: companionAtom(
			store,
			companionFamily(
				store,
				FAMILY_KEYS.presence,
				[] as readonly MosaicPresenceEnvelope<Presence>[],
			),
			key,
		),
		problem: companionAtom(
			store,
			companionFamily(
				store,
				FAMILY_KEYS.problem,
				null as MosaicClientProblem<T> | null,
			),
			key,
		),
		revision: companionAtom(
			store,
			companionFamily(store, FAMILY_KEYS.revision, 0),
			key,
		),
		status: companionAtom(
			store,
			companionFamily(store, FAMILY_KEYS.status, `offline` as const),
			key,
		),
	}
}

function sameConfiguration(
	left: StoreBoundMosaicController<any, any>,
	options: Required<Pick<MosaicSyncOptions, `actor` | `session`>> &
		Pick<MosaicSyncOptions, `transport`>,
): boolean {
	return (
		left.actor === options.actor &&
		left.session === options.session &&
		left.transport === options.transport
	)
}

class StoreBoundMosaicController<
	T extends AnyMosaicTransceiver,
	Presence extends Json.Serializable,
> implements MosaicController<T, Presence> {
	public readonly actor: string
	public readonly atom: ReturnType<typeof mosaicAtomAddress>
	public readonly session: string
	public readonly state: MosaicCompanionAtoms<T, Presence>
	public readonly store: RootStore
	public readonly token: MutableAtomToken<T>
	public transport: MosaicClientTransport | undefined

	readonly #clock: MosaicClientClock
	readonly #TransceiverClass: MosaicTransceiverConstructor<T>
	readonly #idSource: MosaicClientIdSource
	readonly #issuedIds = new Set<string>()
	readonly #key: string
	readonly #presence = new Map<string, MosaicPresenceEnvelope<Presence>>()
	readonly #speculativeHeads = new WeakMap<object, Set<string>>()
	readonly #stopAtomDisposal: () => void
	readonly #stopLocalSignals: () => void
	#acceptedIds = new Set<string>()
	#confirmedHeads = new Set<string>()
	#confirmedSnapshot: MosaicSnapshot<T>
	#disposeTransport: (() => void) | null = null
	#disposed = false
	#hydrated = false
	#idSequence = 0
	#lastIdTime = 0
	#online = false
	#pending: ModelProposal<T>[] = []
	#problem: MosaicClientProblem<T> | null = null
	#revision = 0
	#sent = new Set<string>()
	#status: MosaicClientStatus = `offline`
	#suppressLocalSignals = false

	public constructor(
		store: RootStore,
		token: MutableAtomToken<T>,
		options: MosaicSyncOptions & { readonly session: string },
		key: string,
	) {
		this.store = store
		this.#key = key
		this.actor = options.actor
		this.atom = mosaicAtomAddress(token)
		this.#clock =
			typeof options.clock === `function`
				? { now: options.clock }
				: (options.clock ?? SYSTEM_TIME)
		this.#TransceiverClass = withdraw(store, token)
			.class as MosaicTransceiverConstructor<T>
		if (
			this.#TransceiverClass.timelinePolicy !== `append-only` ||
			!isRecord(this.#TransceiverClass.mosaic)
		) {
			throw new Error(
				`Mutable atom \"${token.key}\" does not contain a Mosaic transceiver`,
			)
		}
		this.#idSource = options.idSource ?? defaultIdSource
		this.session = options.session
		this.#issuedIds.add(this.session)
		this.state = createCompanionAtoms<T, Presence>(
			store,
			`${mosaicAtomAddressKey(this.atom)}\u0000${this.session}`,
		)
		this.token = token
		this.transport = options.transport
		this.#confirmedSnapshot = structuredClone(
			getFromStore(store, getJsonTokenFromStore(store, token)),
		) as MosaicSnapshot<T>
		this.#stopLocalSignals = subscribeToState(
			store,
			getUpdateToken(token),
			`${key}:outbox`,
			({ newValue }) => {
				if (!this.#suppressLocalSignals) this.#captureLocalSignal(newValue)
			},
		)
		this.#stopAtomDisposal = store.on.atomDisposal.subscribe(
			`${key}:atom-disposal`,
			(disposed) => {
				if (disposed.key === token.key) this.dispose()
			},
		)
		if (options.transport !== undefined) this.connect(options.transport)
	}

	public [Symbol.dispose](): void {
		this.dispose()
	}

	public change(
		intent: MosaicIntent<T>,
		options: MosaicSubmitOptions = {},
	): MosaicSignal<T> | null {
		if (this.#disposed || this.#status === `rejected`) return null
		const id = this.#nextId(`operation`)
		let signal: MosaicSignal<T> | null = null
		// A running transaction owns a child Store and a cloned transceiver. Using
		// the newest Store keeps speculative signals isolated until tracker replay
		// commits them into the root Store.
		const target = newest(this.store)
		const visibleHeads =
			target === this.store
				? this.#visibleHeads()
				: (this.#speculativeHeads.get(target) ?? this.#visibleHeads())
		setIntoStore(target, this.token, (transceiver) => {
			signal = transceiver.change(intent, {
				actor: this.actor,
				dependencies: [...visibleHeads].sort(),
				group: options.group ?? null,
				id,
				now: this.#clock.now(),
				revision: null,
				session: this.session,
			})
			return transceiver
		})
		const emitted = signal as MosaicSignal<T> | null
		if (emitted !== null && target !== this.store) {
			const nextHeads = new Set(visibleHeads)
			for (const dependency of emitted.dependencies) nextHeads.delete(dependency)
			nextHeads.add(emitted.id)
			this.#speculativeHeads.set(target, nextHeads)
		}
		return emitted
	}

	public clearProblem(): void {
		if (this.#problem === null) return
		this.#problem = null
		this.#publishState()
	}

	public connect(transport: MosaicClientTransport): () => void {
		if (this.#disposed) throw new Error(`Cannot connect a disposed Mosaic`)
		this.#disposeTransport?.()
		this.transport = transport

		const onConnect = (): void => {
			this.#online = true
			this.#join(this.#status === `recovering` ? `recovering` : `syncing`)
		}
		const onDisconnect = (): void => {
			this.#online = false
			this.#hydrated = false
			this.#sent.clear()
			this.#presence.clear()
			this.#status = `offline`
			this.#publishState()
		}
		const onSnapshot = (...args: Json.Serializable[]): void => {
			this.#receiveSnapshot(args[0])
		}
		const onOperation = (...args: Json.Serializable[]): void => {
			this.#receiveOperation(args[0])
		}
		const onPresence = (...args: Json.Serializable[]): void => {
			this.#receivePresence(args[0])
		}
		const onRejection = (...args: Json.Serializable[]): void => {
			this.#receiveRejection(args[0])
		}

		transport.on(`connect`, onConnect)
		transport.on(`disconnect`, onDisconnect)
		transport.on(MOSAIC_EVENTS.snapshot, onSnapshot)
		transport.on(MOSAIC_EVENTS.operation, onOperation)
		transport.on(MOSAIC_EVENTS.presence, onPresence)
		transport.on(MOSAIC_EVENTS.rejection, onRejection)

		let active = true
		const dispose = (): void => {
			if (!active) return
			active = false
			this.publishPresence(null)
			transport.off(`connect`, onConnect)
			transport.off(`disconnect`, onDisconnect)
			transport.off(MOSAIC_EVENTS.snapshot, onSnapshot)
			transport.off(MOSAIC_EVENTS.operation, onOperation)
			transport.off(MOSAIC_EVENTS.presence, onPresence)
			transport.off(MOSAIC_EVENTS.rejection, onRejection)
			if (this.transport === transport) {
				this.transport = undefined
				this.#online = false
				this.#hydrated = false
				this.#sent.clear()
				this.#presence.clear()
				this.#status = `offline`
				this.#publishState()
			}
			if (this.#disposeTransport === dispose) this.#disposeTransport = null
		}
		this.#disposeTransport = dispose

		if (transport.connected !== false) onConnect()
		return dispose
	}

	public createGroupId(): string {
		return this.#nextId(`group`)
	}

	public dispose(): void {
		if (this.#disposed) return
		this.#disposed = true
		this.#disposeTransport?.()
		this.#stopLocalSignals()
		this.#stopAtomDisposal()
		if (this.store.miscResources.get(this.#key) === this) {
			this.store.miscResources.delete(this.#key)
		}
		for (const token of Object.values(this.state)) {
			disposeFromStore(this.store, token)
		}
	}

	public publishPresence(presence: Presence | null): void {
		if (!this.#online || !this.#hydrated || this.transport === undefined) return
		const proposal: MosaicPresenceProposal<Presence | null> = {
			atom: this.atom,
			presence,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			session: this.session,
		}
		this.#applyPresence({ ...proposal, actor: this.actor })
		this.transport.emit(MOSAIC_EVENTS.presence, proposal)
	}

	public retryPending(): void {
		this.#sent.clear()
		this.#flush()
	}

	public synchronize(): void {
		if (this.#online) this.#join(`syncing`)
	}

	#applyPresence(envelope: MosaicPresenceEnvelope<Presence | null>): void {
		const key = presenceKey(envelope.actor, envelope.session)
		if (envelope.presence === null) this.#presence.delete(key)
		else {
			this.#presence.set(key, envelope as MosaicPresenceEnvelope<Presence>)
		}
		this.#publishState()
	}

	#captureLocalSignal(signal: MosaicSignal<T>): void {
		if (
			signal.actor !== this.actor ||
			signal.session !== this.session ||
			signal.revision !== null
		) {
			this.#protocolProblem(
				`A local Mosaic signal had foreign or authoritative metadata.`,
				false,
			)
			return
		}
		if (this.#pending.some(({ id }) => id === signal.id)) return
		this.#issuedIds.add(signal.id)
		this.#pending.push({
			atom: this.atom,
			dependencies: signal.dependencies,
			group: signal.group,
			id: signal.id,
			model: this.#TransceiverClass.mosaic,
			operation: signal.operation,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			session: signal.session,
		})
		this.#publishState()
		this.#flush()
	}

	#flush(): void {
		if (!this.#online || !this.#hydrated || this.transport === undefined) return
		for (const envelope of this.#pending) {
			if (this.#sent.has(envelope.id)) continue
			this.#sent.add(envelope.id)
			this.transport.emit(MOSAIC_EVENTS.operation, envelope)
		}
	}

	#isForAtom(envelope: Record<string, unknown>): boolean {
		if (!isRecord(envelope[`atom`])) return false
		try {
			return (
				mosaicAtomAddressKey(
					envelope[`atom`] as unknown as ReturnType<typeof mosaicAtomAddress>,
				) === mosaicAtomAddressKey(this.atom)
			)
		} catch {
			return false
		}
	}

	#join(status: `recovering` | `syncing`): void {
		if (!this.#online || this.transport === undefined) return
		this.#hydrated = false
		this.#sent.clear()
		this.#status = status
		this.#publishState()
		const request: MosaicJoinEnvelope = {
			atom: this.atom,
			knownRevision: this.#revision,
			model: this.#TransceiverClass.mosaic,
			pendingOperationIds: this.#pending.map(({ id }) => id),
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			session: this.session,
		}
		this.transport.emit(MOSAIC_EVENTS.join, request)
	}

	#matches(envelope: MosaicOperationEnvelope): boolean {
		return (
			this.#matchesAtom(envelope) &&
			typeof envelope.actor === `string` &&
			envelope.actor.length > 0 &&
			Array.isArray(envelope.dependencies) &&
			envelope.dependencies.every((id) => typeof id === `string`) &&
			(envelope.group === null || typeof envelope.group === `string`) &&
			typeof envelope.id === `string` &&
			envelope.id.length > 0 &&
			typeof envelope.session === `string` &&
			envelope.session.length > 0 &&
			isRecord(envelope.model) &&
			envelope.model.key === this.#TransceiverClass.mosaic.key &&
			envelope.model.version === this.#TransceiverClass.mosaic.version
		)
	}

	#matchesAtom(envelope: Record<string, unknown>): boolean {
		return (
			envelope[`protocolVersion`] === MOSAIC_PROTOCOL_VERSION &&
			this.#isForAtom(envelope)
		)
	}

	#nextId(kind: `group` | `operation`): string {
		this.#lastIdTime = Math.max(this.#lastIdTime, this.#clock.now())
		const id = this.#idSource({
			actor: this.actor,
			kind,
			now: this.#lastIdTime,
			sequence: this.#idSequence++,
			session: this.session,
		})
		if (id.length === 0) throw new Error(`Mosaic ${kind} ID cannot be empty`)
		if (this.#issuedIds.has(id)) {
			throw new Error(`Mosaic ${kind} ID \"${id}\" was already issued`)
		}
		this.#issuedIds.add(id)
		return id
	}

	#protocolProblem(reason: string, recover: boolean): void {
		const discarded = this.#quarantinePending()
		this.#problem = { discarded, kind: `protocol`, reason }
		if (recover && this.#online) this.#join(`recovering`)
		else {
			this.#hydrated = false
			this.#status = `rejected`
			this.#publishState()
		}
	}

	#publishState(): void {
		if (this.#disposed) return
		setIntoStore(
			this.store,
			this.state.pending,
			this.#pending.map(({ id }) => id),
		)
		setIntoStore(
			this.store,
			this.state.presence,
			[...this.#presence.values()].sort(
				(left, right) =>
					left.actor.localeCompare(right.actor) ||
					left.session.localeCompare(right.session),
			),
		)
		setIntoStore(this.store, this.state.problem, this.#problem)
		setIntoStore(this.store, this.state.revision, this.#revision)
		setIntoStore(this.store, this.state.status, this.#status)
	}

	#quarantineOperationAndDependents(
		operationId: string,
	): readonly ModelProposal<T>[] {
		const discardedIds = new Set([operationId])
		let changed = true
		while (changed) {
			changed = false
			for (const operation of this.#pending) {
				if (
					!discardedIds.has(operation.id) &&
					operation.dependencies.some((id) => discardedIds.has(id))
				) {
					discardedIds.add(operation.id)
					changed = true
				}
			}
		}
		const discarded = this.#pending.filter(({ id }) => discardedIds.has(id))
		this.#pending = this.#pending.filter(({ id }) => !discardedIds.has(id))
		for (const id of discardedIds) this.#sent.delete(id)
		this.#reproject()
		return discarded
	}

	#quarantinePending(): readonly ModelProposal<T>[] {
		const discarded = this.#pending
		this.#pending = []
		this.#sent.clear()
		this.#reproject()
		return discarded
	}

	#receiveOperation(value: Json.Serializable | undefined): void {
		if (!isRecord(value) || !isRecord(value[`operation`])) {
			this.#protocolProblem(`Received a malformed accepted operation.`, true)
			return
		}
		if (!this.#isForAtom(value[`operation`])) return
		const accepted = value as unknown as MosaicAcceptedOperationEnvelope<
			MosaicOperation<T>
		>
		if (!this.#matches(accepted.operation)) return
		if (!Number.isSafeInteger(accepted.revision) || accepted.revision < 1) {
			this.#protocolProblem(`Received an invalid stream revision.`, true)
			return
		}

		const ownPending = this.#pending.some(
			(envelope) => envelope.id === accepted.operation.id,
		)
		if (accepted.revision <= this.#revision) {
			if (this.#acceptedIds.has(accepted.operation.id) || ownPending) {
				this.#acceptedIds.add(accepted.operation.id)
				this.#removePending(accepted.operation.id)
			}
			return
		}
		if (accepted.revision !== this.#revision + 1) {
			this.#join(`recovering`)
			return
		}
		if (this.#acceptedIds.has(accepted.operation.id)) {
			this.#protocolProblem(
				`Operation ${accepted.operation.id} was assigned more than one revision.`,
				true,
			)
			return
		}

		try {
			const confirmed = this.#TransceiverClass.fromJSON(
				this.#confirmedSnapshot as unknown as AsJSON<T>,
			)
			confirmed.do({
				actor: accepted.operation.actor,
				dependencies: accepted.operation.dependencies,
				group: accepted.operation.group,
				id: accepted.operation.id,
				operation: accepted.operation.operation,
				revision: accepted.revision,
				session: accepted.operation.session,
			})
			this.#confirmedSnapshot = confirmed.toJSON() as MosaicSnapshot<T>
		} catch (error) {
			this.#protocolProblem(
				`An accepted operation could not be applied: ${String(error)}`,
				true,
			)
			return
		}
		this.#revision = accepted.revision
		this.#acceptedIds.add(accepted.operation.id)
		for (const dependency of accepted.operation.dependencies) {
			this.#confirmedHeads.delete(dependency)
		}
		this.#confirmedHeads.add(accepted.operation.id)
		this.#pending = this.#pending.filter(
			(operation) => operation.id !== accepted.operation.id,
		)
		this.#sent.delete(accepted.operation.id)
		if (!this.#reproject()) return
		this.#status = `live`
		this.#publishState()
		this.#flush()
	}

	#receivePresence(value: Json.Serializable | undefined): void {
		if (!isRecord(value) || !this.#isForAtom(value)) return
		if (
			!this.#matchesAtom(value) ||
			typeof value[`actor`] !== `string` ||
			typeof value[`session`] !== `string` ||
			!(`presence` in value)
		) {
			return
		}
		this.#applyPresence(
			value as unknown as MosaicPresenceEnvelope<Presence | null>,
		)
	}

	#receiveRejection(value: Json.Serializable | undefined): void {
		if (!isRecord(value)) {
			this.#protocolProblem(`Received a malformed rejection.`, false)
			return
		}
		if (!this.#isForAtom(value)) return
		if (
			typeof value[`session`] === `string` &&
			value[`session`] !== this.session
		) {
			return
		}
		if (
			!this.#matchesAtom(value) ||
			typeof value[`session`] !== `string` ||
			(value[`operationId`] !== null &&
				typeof value[`operationId`] !== `string`) ||
			typeof value[`code`] !== `string` ||
			!REJECTION_CODES.has(value[`code`]) ||
			typeof value[`reason`] !== `string` ||
			typeof value[`recovery`] !== `string` ||
			!RECOVERIES.has(value[`recovery`])
		) {
			this.#protocolProblem(`Received a malformed rejection.`, false)
			return
		}
		const rejection = value as unknown as MosaicRejectionEnvelope
		if (
			rejection.operationId !== null &&
			!this.#pending.some(({ id }) => id === rejection.operationId)
		) {
			return
		}
		let discarded: readonly ModelProposal<T>[] = []
		if (
			rejection.recovery === `retry` ||
			(rejection.recovery === `resnapshot` && rejection.code !== `stale-history`)
		) {
			if (rejection.operationId !== null) {
				this.#sent.delete(rejection.operationId)
			}
		} else if (rejection.operationId !== null) {
			discarded = this.#quarantineOperationAndDependents(rejection.operationId)
		} else discarded = this.#quarantinePending()
		this.#problem = {
			code: rejection.code,
			discarded,
			kind: `rejection`,
			operationId: rejection.operationId,
			reason: rejection.reason,
			recovery: rejection.recovery,
		}
		if (rejection.recovery === `none` || rejection.recovery === `upgrade`) {
			this.#hydrated = false
			this.#status = `rejected`
			this.#publishState()
			return
		}
		if (rejection.recovery === `resnapshot`) this.#join(`recovering`)
		else {
			this.#status = `live`
			this.#publishState()
		}
	}

	#receiveSnapshot(value: Json.Serializable | undefined): void {
		if (!isRecord(value)) {
			this.#protocolProblem(`Received a malformed Mosaic snapshot.`, false)
			return
		}
		if (!this.#isForAtom(value)) return
		if (
			typeof value[`session`] === `string` &&
			value[`session`] !== this.session
		) {
			return
		}
		if (
			!this.#matchesAtom(value) ||
			typeof value[`session`] !== `string` ||
			!isRecord(value[`model`]) ||
			value[`model`][`key`] !== this.#TransceiverClass.mosaic.key ||
			value[`model`][`version`] !== this.#TransceiverClass.mosaic.version ||
			!Array.isArray(value[`acceptedPendingOperationIds`]) ||
			!value[`acceptedPendingOperationIds`].every(
				(id) => typeof id === `string`,
			) ||
			!Number.isSafeInteger(value[`revision`]) ||
			(value[`revision`] as number) < 0 ||
			!(`snapshot` in value)
		) {
			this.#protocolProblem(`Received a malformed Mosaic snapshot.`, false)
			return
		}
		const envelope = value as unknown as MosaicSnapshotEnvelope<
			MosaicSnapshot<T>
		>
		if (envelope.revision < this.#revision) return
		try {
			const confirmed = this.#TransceiverClass.fromJSON(
				envelope.snapshot as unknown as AsJSON<T>,
			)
			this.#confirmedSnapshot = confirmed.toJSON() as MosaicSnapshot<T>
		} catch (error) {
			this.#protocolProblem(
				`The Mosaic snapshot could not be hydrated: ${String(error)}`,
				false,
			)
			return
		}

		this.#revision = envelope.revision
		this.#acceptedIds = new Set(envelope.acceptedPendingOperationIds)
		this.#confirmedHeads.clear()
		this.#pending = this.#pending.filter(
			(operation) => !this.#acceptedIds.has(operation.id),
		)
		this.#sent.clear()
		if (!this.#reproject()) return
		this.#hydrated = true
		this.#status = `live`
		this.#publishState()
		this.#flush()
	}

	#removePending(id: string): void {
		this.#pending = this.#pending.filter((operation) => operation.id !== id)
		this.#sent.delete(id)
		this.#reproject()
	}

	#reproject(): boolean {
		this.#suppressLocalSignals = true
		try {
			setIntoStore(
				this.store,
				getJsonTokenFromStore(this.store, this.token),
				structuredClone(this.#confirmedSnapshot) as unknown as AsJSON<T>,
			)
			const updateToken = getUpdateToken(this.token)
			for (const pending of this.#pending) {
				setIntoStore(this.store, updateToken, {
					actor: this.actor,
					dependencies: pending.dependencies,
					group: pending.group,
					id: pending.id,
					operation: pending.operation,
					revision: null,
					session: pending.session,
				} as unknown as SignalFrom<T>)
			}
			return true
		} catch (error) {
			this.#protocolProblem(
				`A pending operation could not be rebased: ${String(error)}`,
				true,
			)
			return false
		} finally {
			this.#suppressLocalSignals = false
		}
	}

	#visibleHeads(): Set<string> {
		const heads = new Set(this.#confirmedHeads)
		for (const pending of this.#pending) {
			for (const dependency of pending.dependencies) heads.delete(dependency)
			heads.add(pending.id)
		}
		return heads
	}
}

/**
 * Synchronize an ordinary Mosaic mutable atom in one Store. Equivalent callers
 * share the Store-owned replica for this atom address and session.
 */
export function syncMosaic<
	T extends AnyMosaicTransceiver,
	Presence extends Json.Serializable = Json.Serializable,
>(
	store: RootStore,
	token: MutableAtomToken<T>,
	options: MosaicSyncOptions,
): MosaicController<T, Presence> {
	if (options.actor.length === 0) throw new Error(`Mosaic actor cannot be empty`)
	const session =
		options.session ??
		(options.idSource ?? defaultIdSource)({
			actor: options.actor,
			kind: `session`,
			now:
				typeof options.clock === `function`
					? options.clock()
					: (options.clock ?? SYSTEM_TIME).now(),
			sequence: 0,
			session: null,
		})
	if (session.length === 0) throw new Error(`Mosaic session cannot be empty`)

	getFromStore(store, token)
	const key = `mosaic:${mosaicAtomAddressKey(mosaicAtomAddress(token))}:${session}`
	const configuration = { ...options, session }
	const existing = store.miscResources.get(key)
	if (existing !== undefined) {
		if (
			existing instanceof StoreBoundMosaicController &&
			sameConfiguration(existing, configuration)
		) {
			return existing as MosaicController<T, Presence>
		}
		throw new Error(
			`Mosaic atom \"${token.key}\" already has a different configuration for session \"${session}\" in Store \"${store.config.name}\"`,
		)
	}

	const controller = new StoreBoundMosaicController<T, Presence>(
		store,
		token,
		configuration,
		key,
	)
	store.miscResources.set(key, controller)
	return controller
}
