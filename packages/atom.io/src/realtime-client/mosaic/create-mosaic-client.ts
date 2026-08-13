import type { Json } from "atom.io/foundations/json"
import {
	type AnyMosaicModel,
	MOSAIC_EVENTS,
	MOSAIC_PROTOCOL_VERSION,
	type MosaicAcceptedOperationEnvelope,
	type MosaicIntent,
	type MosaicJoinEnvelope,
	type MosaicOperation,
	type MosaicOperationEnvelope,
	type MosaicOperationMetadata,
	type MosaicOperationProposal,
	type MosaicPrepareContext,
	type MosaicPresenceEnvelope,
	type MosaicPresenceProposal,
	type MosaicRejectionEnvelope,
	type MosaicSnapshot,
	type MosaicSnapshotEnvelope,
	type MosaicState,
} from "atom.io/realtime"

import type {
	MosaicClient,
	MosaicClientClock,
	MosaicClientHistoryAdapter,
	MosaicClientIdContext,
	MosaicClientIdSource,
	MosaicClientOptions,
	MosaicClientProblem,
	MosaicClientSnapshot,
	MosaicClientStatus,
	MosaicClientTransport,
	MosaicSubmitOptions,
} from "./types.ts"

const SYSTEM_TIME: MosaicClientClock = { now: () => Date.now() }

const randomId = (): string => {
	const randomUUID = globalThis.crypto?.randomUUID
	if (randomUUID !== undefined) return randomUUID.call(globalThis.crypto)
	return Math.random().toString(36).slice(2).padEnd(16, `0`)
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

const presenceKey = (actor: string, session: string): string =>
	`${actor}\u0000${session}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === `object` && value !== null && !Array.isArray(value)

const REJECTION_CODES = new Set([
	`capacity-exceeded`,
	`incompatible-version`,
	`invalid-model-operation`,
	`invalid-payload`,
	`missing-dependency`,
	`operation-id-collision`,
	`resource-unavailable`,
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

const metadataFrom = (
	envelope: MosaicOperationProposal,
	actor: string,
): MosaicOperationMetadata => ({
	actor,
	dependencies: envelope.dependencies,
	group: envelope.group,
	id: envelope.id,
	session: envelope.session,
})

type ModelProposal<Model extends AnyMosaicModel> = MosaicOperationProposal<
	MosaicOperation<Model>
>

class MosaicClientEngine<
	Model extends AnyMosaicModel,
	Presence extends Json.Serializable,
	History,
> implements MosaicClient<Model, Presence, History> {
	readonly #actor: string
	readonly #clock: MosaicClientClock
	readonly #history: MosaicClientHistoryAdapter<Model, History> | undefined
	readonly #idSource: MosaicClientIdSource
	readonly #issuedIds = new Set<string>()
	readonly #listeners = new Set<
		(snapshot: MosaicClientSnapshot<Model, Presence, History>) => void
	>()
	readonly #presence = new Map<string, MosaicPresenceEnvelope<Presence>>()
	readonly #resource: MosaicClientOptions<Model, History>[`resource`]
	readonly #session: string
	#acceptedIds = new Set<string>()
	#confirmedHeads = new Set<string>()
	#confirmedState: MosaicState<Model>
	#disposeTransport: (() => void) | null = null
	#hydrated = false
	#idSequence = 0
	#lastIdTime = 0
	#online = false
	#pending: ModelProposal<Model>[] = []
	#problem: MosaicClientProblem<Model> | null = null
	#projectedState: MosaicState<Model>
	#revision = 0
	#sent = new Set<string>()
	#snapshot: MosaicClientSnapshot<Model, Presence, History>
	#status: MosaicClientStatus = `offline`
	#transport: MosaicClientTransport | null = null

	public constructor(options: MosaicClientOptions<Model, History>) {
		if (options.actor.length === 0)
			throw new Error(`Mosaic actor cannot be empty`)
		this.#actor = options.actor
		this.#clock =
			typeof options.clock === `function`
				? { now: options.clock }
				: (options.clock ?? SYSTEM_TIME)
		this.#history = options.history
		this.#idSource = options.idSource ?? defaultIdSource
		this.#resource = options.resource
		this.#session =
			options.session ??
			this.#idSource({
				actor: this.#actor,
				kind: `session`,
				now: this.#clock.now(),
				sequence: this.#idSequence++,
				session: null,
			})
		if (this.#session.length === 0) {
			throw new Error(`Mosaic session cannot be empty`)
		}
		this.#issuedIds.add(this.#session)
		this.#confirmedState = this.#resource.model.create()
		this.#projectedState = this.#confirmedState
		this.#snapshot = this.#makeSnapshot()
		if (options.transport !== undefined) this.connect(options.transport)
	}

	public clearProblem(): void {
		if (this.#problem === null) return
		this.#problem = null
		this.#publish()
	}

	public connect(transport: MosaicClientTransport): () => void {
		this.#disposeTransport?.()
		this.#transport = transport

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
			this.#publish()
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
			if (this.#transport === transport) {
				this.#transport = null
				this.#online = false
				this.#hydrated = false
				this.#sent.clear()
				this.#presence.clear()
				this.#status = `offline`
				this.#publish()
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
		this.#disposeTransport?.()
		this.#listeners.clear()
	}

	public publishPresence(presence: Presence | null): void {
		if (!this.#online || !this.#hydrated || this.#transport === null) return
		const proposal: MosaicPresenceProposal<Presence | null> = {
			presence,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			resource: this.#resource.key,
			session: this.#session,
		}
		const envelope: MosaicPresenceEnvelope<Presence | null> = {
			...proposal,
			actor: this.#actor,
		}
		this.#applyPresence(envelope)
		this.#transport.emit(MOSAIC_EVENTS.presence, proposal)
	}

	public read(): MosaicClientSnapshot<Model, Presence, History> {
		return this.#snapshot
	}

	public retryPending(): void {
		this.#sent.clear()
		this.#flush()
	}

	public redo(options?: MosaicSubmitOptions): ModelProposal<Model> | null {
		return this.#travel(`redo`, options)
	}

	public submit(
		intent: MosaicIntent<Model>,
		options: MosaicSubmitOptions = {},
	): ModelProposal<Model> | null {
		if (this.#status === `rejected`) return null
		const id = this.#nextId(`operation`)
		const dependencies = [...this.#visibleHeads()].sort()
		const metadata: MosaicOperationMetadata = {
			actor: this.#actor,
			dependencies,
			group: options.group ?? null,
			id,
			session: this.#session,
		}
		const prepareContext: MosaicPrepareContext = {
			...metadata,
			now: this.#clock.now(),
			revision: null,
		}
		const operation = this.#resource.model.prepare(
			this.#projectedState,
			intent,
			prepareContext,
		)
		if (operation === null) return null
		const envelope: ModelProposal<Model> = {
			dependencies: metadata.dependencies,
			group: metadata.group,
			id: metadata.id,
			model: {
				key: this.#resource.model.key,
				version: this.#resource.model.version,
			},
			operation,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			resource: this.#resource.key,
			session: metadata.session,
		}
		this.#pending.push(envelope)
		try {
			this.#projectedState = this.#apply(this.#projectedState, envelope)
		} catch (error) {
			this.#pending.pop()
			this.#protocolProblem(
				`The locally prepared operation could not be applied: ${String(error)}`,
				false,
			)
			return null
		}
		this.#publish()
		this.#flush()
		return envelope
	}

	public subscribe(
		listener: (snapshot: MosaicClientSnapshot<Model, Presence, History>) => void,
	): () => void {
		this.#listeners.add(listener)
		return () => this.#listeners.delete(listener)
	}

	public synchronize(): void {
		if (!this.#online) return
		this.#join(`syncing`)
	}

	public undo(options?: MosaicSubmitOptions): ModelProposal<Model> | null {
		return this.#travel(`undo`, options)
	}

	#apply(
		state: MosaicState<Model>,
		envelope: ModelProposal<Model>,
		actor = this.#actor,
		revision: number | null = null,
	): MosaicState<Model> {
		return this.#resource.model.apply(state, envelope.operation, {
			...metadataFrom(envelope, actor),
			revision,
		})
	}

	#applyPresence(envelope: MosaicPresenceEnvelope<Presence | null>): void {
		const key = presenceKey(envelope.actor, envelope.session)
		if (envelope.presence === null) this.#presence.delete(key)
		else {
			this.#presence.set(key, envelope as MosaicPresenceEnvelope<Presence>)
		}
		this.#publish()
	}

	#flush(): void {
		if (!this.#online || !this.#hydrated || this.#transport === null) return
		for (const envelope of [...this.#pending]) {
			if (this.#sent.has(envelope.id)) continue
			this.#sent.add(envelope.id)
			this.#transport.emit(MOSAIC_EVENTS.operation, envelope)
		}
	}

	#join(status: `recovering` | `syncing`): void {
		if (!this.#online || this.#transport === null) return
		this.#hydrated = false
		this.#sent.clear()
		this.#status = status
		this.#publish()
		const request: MosaicJoinEnvelope = {
			knownRevision: this.#revision,
			model: {
				key: this.#resource.model.key,
				version: this.#resource.model.version,
			},
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			pendingOperationIds: this.#pending.map(({ id }) => id),
			resource: this.#resource.key,
			session: this.#session,
		}
		this.#transport.emit(MOSAIC_EVENTS.join, request)
	}

	#makeSnapshot(): MosaicClientSnapshot<Model, Presence, History> {
		return {
			actor: this.#actor,
			history: (this.#history?.read(this.#projectedState, this.#actor) ??
				null) as History,
			pendingOperationIds: this.#pending.map(({ id }) => id),
			presence: [...this.#presence.values()].sort(
				(left, right) =>
					left.actor.localeCompare(right.actor) ||
					left.session.localeCompare(right.session),
			),
			problem: this.#problem,
			resource: this.#resource,
			revision: this.#revision,
			session: this.#session,
			state: this.#projectedState,
			status: this.#status,
		}
	}

	#nextId(kind: `group` | `operation`): string {
		this.#lastIdTime = Math.max(this.#lastIdTime, this.#clock.now())
		const id = this.#idSource({
			actor: this.#actor,
			kind,
			now: this.#lastIdTime,
			sequence: this.#idSequence++,
			session: this.#session,
		})
		if (id.length === 0) throw new Error(`Mosaic ${kind} ID cannot be empty`)
		if (this.#issuedIds.has(id)) {
			throw new Error(`Mosaic ${kind} ID "${id}" was already issued`)
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
			this.#publish()
		}
	}

	#publish(): void {
		this.#snapshot = this.#makeSnapshot()
		for (const listener of [...this.#listeners]) listener(this.#snapshot)
	}

	#quarantinePending(): readonly ModelProposal<Model>[] {
		const discarded = this.#pending
		this.#pending = []
		this.#sent.clear()
		this.#projectedState = this.#confirmedState
		return discarded
	}

	#quarantineOperationAndDependents(
		operationId: string,
	): readonly ModelProposal<Model>[] {
		const discardedIds = new Set([operationId])
		for (const operation of this.#pending) {
			if (operation.dependencies.some((id) => discardedIds.has(id))) {
				discardedIds.add(operation.id)
			}
		}
		const discarded = this.#pending.filter(({ id }) => discardedIds.has(id))
		this.#pending = this.#pending.filter(({ id }) => !discardedIds.has(id))
		for (const id of discardedIds) this.#sent.delete(id)
		this.#reproject()
		return discarded
	}

	#receiveOperation(value: Json.Serializable | undefined): void {
		if (!isRecord(value) || !isRecord(value[`operation`])) {
			this.#protocolProblem(`Received a malformed accepted operation.`, true)
			return
		}
		if (!this.#isForResource(value[`operation`])) return
		const accepted = value as MosaicAcceptedOperationEnvelope<
			MosaicOperation<Model>
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
			this.#confirmedState = this.#apply(
				this.#confirmedState,
				accepted.operation,
				accepted.operation.actor,
				accepted.revision,
			)
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
		this.#removePending(accepted.operation.id)
		this.#status = `live`
		this.#publish()
		this.#flush()
	}

	#receivePresence(value: Json.Serializable | undefined): void {
		if (!isRecord(value) || !this.#isForResource(value)) return
		if (
			!this.#matchesResource(value) ||
			typeof value[`actor`] !== `string` ||
			typeof value[`session`] !== `string` ||
			!(`presence` in value)
		) {
			return
		}
		this.#applyPresence(value as MosaicPresenceEnvelope<Presence | null>)
	}

	#receiveRejection(value: Json.Serializable | undefined): void {
		if (!isRecord(value)) {
			this.#protocolProblem(`Received a malformed rejection.`, false)
			return
		}
		if (!this.#isForResource(value)) return
		if (
			typeof value[`session`] === `string` &&
			value[`session`] !== this.#session
		) {
			return
		}
		if (
			!this.#matchesResource(value) ||
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
		const rejection = value as MosaicRejectionEnvelope
		if (
			rejection.operationId !== null &&
			!this.#pending.some(({ id }) => id === rejection.operationId)
		) {
			return
		}
		let discarded: readonly ModelProposal<Model>[] = []
		if (
			rejection.recovery === `retry` ||
			(rejection.recovery === `resnapshot` && rejection.code !== `stale-history`)
		) {
			if (rejection.operationId !== null)
				this.#sent.delete(rejection.operationId)
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
			this.#publish()
			return
		}
		if (rejection.recovery === `resnapshot`) this.#join(`recovering`)
		else {
			this.#status = `live`
			this.#publish()
		}
	}

	#receiveSnapshot(value: Json.Serializable | undefined): void {
		if (!isRecord(value)) {
			this.#protocolProblem(`Received a malformed Mosaic snapshot.`, false)
			return
		}
		if (!this.#isForResource(value)) return
		if (
			typeof value[`session`] === `string` &&
			value[`session`] !== this.#session
		) {
			return
		}
		if (
			!this.#matchesResource(value) ||
			typeof value[`session`] !== `string` ||
			!isRecord(value[`model`]) ||
			value[`model`][`key`] !== this.#resource.model.key ||
			value[`model`][`version`] !== this.#resource.model.version ||
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
		const envelope = value as MosaicSnapshotEnvelope<MosaicSnapshot<Model>>
		if (envelope.revision < this.#revision) return
		let confirmed: MosaicState<Model>
		try {
			confirmed = this.#resource.model.hydrate(envelope.snapshot)
		} catch (error) {
			this.#protocolProblem(
				`The Mosaic snapshot could not be hydrated: ${String(error)}`,
				false,
			)
			return
		}

		this.#confirmedState = confirmed
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
		this.#publish()
		this.#flush()
	}

	#matches(envelope: MosaicOperationEnvelope): boolean {
		return (
			this.#matchesResource(envelope) &&
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
			envelope.model.key === this.#resource.model.key &&
			envelope.model.version === this.#resource.model.version
		)
	}

	#isForResource(envelope: Record<string, unknown>): boolean {
		return envelope[`resource`] === this.#resource.key
	}

	#matchesResource(envelope: Record<string, unknown>): boolean {
		return (
			envelope[`protocolVersion`] === MOSAIC_PROTOCOL_VERSION &&
			envelope[`resource`] === this.#resource.key
		)
	}

	#removePending(id: string): void {
		this.#pending = this.#pending.filter((operation) => operation.id !== id)
		this.#sent.delete(id)
		this.#reproject()
	}

	#reproject(): boolean {
		let projected = this.#confirmedState
		try {
			for (const pending of this.#pending)
				projected = this.#apply(projected, pending)
		} catch (error) {
			this.#protocolProblem(
				`A pending operation could not be rebased: ${String(error)}`,
				true,
			)
			return false
		}
		this.#projectedState = projected
		return true
	}

	#travel(
		mode: `redo` | `undo`,
		options: MosaicSubmitOptions = {},
	): ModelProposal<Model> | null {
		if (this.#history === undefined) return null
		const intent = this.#history.intent(mode, this.#projectedState, this.#actor)
		if (intent === null) return null
		return this.submit(intent, options)
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

/** Create a transport- and renderer-independent optimistic Mosaic client. */
export function createMosaicClient<
	Model extends AnyMosaicModel,
	Presence extends Json.Serializable = Json.Serializable,
	History = null,
>(
	options: MosaicClientOptions<Model, History>,
): MosaicClient<Model, Presence, History> {
	return new MosaicClientEngine(options)
}
