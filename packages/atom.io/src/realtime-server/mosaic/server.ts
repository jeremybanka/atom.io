import { createHash } from "node:crypto"

import type { MutableAtomFamilyToken, MutableAtomToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import type { Json } from "atom.io/foundations/json"
import {
	type AnyMosaicTransceiver,
	MOSAIC_EVENTS,
	MOSAIC_PROTOCOL_VERSION,
	type MosaicAcceptedOperationEnvelope,
	type MosaicAtomAddress,
	mosaicAtomAddressKey,
	type MosaicJoinEnvelope,
	type MosaicOperation,
	type MosaicOperationEnvelope,
	type MosaicOperationProposal,
	type MosaicPresenceEnvelope,
	type MosaicPresenceProposal,
	type MosaicRejectionCode,
	type MosaicRejectionEnvelope,
	type MosaicSnapshot,
	type MosaicSnapshotEnvelope,
	type MosaicTransceiverConstructor,
	type Socket,
	type StandardSchemaV1,
} from "atom.io/realtime"

import {
	InMemoryMosaicStorage,
	type MosaicStorageAdapter,
	type MosaicStorageRecovery,
} from "./storage.ts"

type MaybePromise<Value> = Promise<Value> | Value

export type MosaicAuthorizationAction = `presence` | `propose` | `read`

export type MosaicAuthorizationContext<Operation = Json.Serializable> = {
	readonly action: MosaicAuthorizationAction
	readonly actor: string
	readonly operation?: Operation
	readonly atom: MosaicAtomAddress
	readonly session: string
}

export type MosaicHistoryRequest = {
	readonly mode: `redo` | `undo`
	readonly targetOperationIds: readonly string[]
}

export type MosaicHistoryGroup = {
	readonly group: string
	readonly targetOperationIds: readonly string[]
}

export type MosaicHistoryTimeline = {
	readonly redo: readonly MosaicHistoryGroup[]
	readonly undo: readonly MosaicHistoryGroup[]
}

export type MosaicPresenceContext<View> = {
	readonly actor: string
	readonly atom: MosaicAtomAddress
	readonly session: string
	readonly view: View
}

/** A mutable transceiver class whose static metadata identifies its wire model. */
export type MosaicTransceiverClass<
	T extends AnyMosaicTransceiver = AnyMosaicTransceiver,
> = MosaicTransceiverConstructor<T>

export type MosaicServerTarget<T extends AnyMosaicTransceiver> =
	| MutableAtomToken<T>
	| MutableAtomFamilyToken<T, Canonical>

export type MosaicServerAtom<
	T extends AnyMosaicTransceiver,
	Presence extends Json.Serializable = Json.Serializable,
> = {
	/** Checkpoint automatically after this many accepted operations. */
	readonly checkpointEvery?: number
	/** The transceiver class registered for this ordinary mutable atom target. */
	readonly class: MosaicTransceiverClass<T>
	/** Validate and normalize untrusted model payloads before authorization. */
	readonly operationSchema: StandardSchemaV1<unknown, MosaicOperation<T>>
	/** Presence is disabled unless a schema is supplied. */
	readonly presenceSchema?: StandardSchemaV1<unknown, Presence>
	/** A mutable atom token or mutable atom family token from the state graph. */
	readonly target: MosaicServerTarget<T>
	/** Perform model-aware checks such as validating relative anchors. */
	readonly validatePresence?: (
		presence: Presence,
		context: MosaicPresenceContext<T[`READONLY_VIEW`]>,
	) => MaybePromise<boolean>
}

export type MosaicServerConnection = {
	readonly actor: string
	readonly session: string
	readonly socket: Socket
}

/** Internal erasure that preserves heterogeneous atom/presence inference. */
type ErasedAtom = {
	readonly checkpointEvery?: number
	readonly class: MosaicTransceiverClass
	readonly operationSchema: StandardSchemaV1<unknown, any>
	readonly presenceSchema?: StandardSchemaV1<unknown, any>
	readonly target: MosaicServerTarget<AnyMosaicTransceiver>
	readonly validatePresence?: (
		presence: any,
		context: MosaicPresenceContext<any>,
	) => MaybePromise<boolean>
}

export type MosaicServerOptions = {
	readonly authorize?: (
		context: MosaicAuthorizationContext,
	) => MaybePromise<boolean>
	readonly atoms: readonly ErasedAtom[]
	readonly storage?: MosaicStorageAdapter
}

export type MosaicServerAtomStatus = {
	readonly initialized: boolean
	readonly revision: number
}

export type MosaicServer = {
	checkpoint(atom: MosaicAtomAddress): Promise<boolean>
	connect(connection: MosaicServerConnection): () => Promise<void>
	dispose(): Promise<void>
	atomStatus(atom: MosaicAtomAddress): MosaicServerAtomStatus
}

type AtomRuntime = {
	checkpointTail: Promise<void>
	disposeWatch: (() => void) | undefined
	headRevision: number
	initialized: boolean
	receiptIds: Set<string>
	atom: ErasedAtom
	address: MosaicAtomAddress
	retentionEpoch: number
	tail: Promise<void>
	transceiver: AnyMosaicTransceiver
}

type ConnectionState = MosaicServerConnection & {
	disposed: boolean
	joined: Set<string>
	listeners: Array<readonly [string, (...args: Json.Serializable[]) => void]>
}

type PresenceRecord = {
	connection: ConnectionState
	presence: Json.Serializable
}

type RejectionOptions = {
	code: MosaicRejectionCode
	operationId?: string | null
	reason: string
	recovery: MosaicRejectionEnvelope[`recovery`]
	atom: MosaicAtomAddress
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === `object` && value !== null && !Array.isArray(value)

const isIdentifier = (value: unknown, maximum = 512): value is string =>
	typeof value === `string` && value.length > 0 && value.length <= maximum

const parseAtomAddress = (value: unknown): MosaicAtomAddress | null => {
	if (
		!isRecord(value) ||
		value[`type`] !== `mutable_atom` ||
		!isIdentifier(value[`key`])
	) {
		return null
	}
	const family = value[`family`]
	if (family === undefined) return { key: value[`key`], type: `mutable_atom` }
	if (
		!isRecord(family) ||
		!isIdentifier(family[`key`]) ||
		!isIdentifier(family[`subKey`]) ||
		value[`key`] !== `${family[`key`]}(${family[`subKey`]})`
	) {
		return null
	}
	return {
		family: { key: family[`key`], subKey: family[`subKey`] },
		key: value[`key`],
		type: `mutable_atom`,
	}
}

const sameAtom = (left: MosaicAtomAddress, right: MosaicAtomAddress): boolean =>
	left.key === right.key &&
	left.type === right.type &&
	left.family?.key === right.family?.key &&
	left.family?.subKey === right.family?.subKey

const unknownAtom = { key: `unknown`, type: `mutable_atom` } as const

const atomFromPayload = (payload: unknown): MosaicAtomAddress =>
	isRecord(payload)
		? (parseAtomAddress(payload[`atom`]) ?? unknownAtom)
		: unknownAtom

const matchesModel = (
	actual: unknown,
	expected: { readonly key: string; readonly version: number },
): boolean =>
	isRecord(actual) &&
	actual[`key`] === expected.key &&
	actual[`version`] === expected.version

const sameStrings = (
	left: readonly string[],
	right: readonly string[],
): boolean =>
	left.length === right.length &&
	left.every((value, index) => value === right[index])

const historyRequest = (value: unknown): MosaicHistoryRequest | null => {
	if (
		!isRecord(value) ||
		value[`type`] !== `history` ||
		(value[`mode`] !== `undo` && value[`mode`] !== `redo`) ||
		!Array.isArray(value[`targetOperationIds`]) ||
		!value[`targetOperationIds`].every((id) => isIdentifier(id))
	) {
		return null
	}
	return {
		mode: value[`mode`],
		targetOperationIds: value[`targetOperationIds`],
	}
}

const canonicalize = (value: Json.Serializable): string => {
	if (value === null || typeof value !== `object`) return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(`,`)}]`
	const object = value as Readonly<Record<string, Json.Serializable>>
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`)
		.join(`,`)}}`
}

/** Fingerprint the schema-normalized proposal, including actor and session. */
export const fingerprintMosaicOperation = (
	operation: MosaicOperationEnvelope,
): string => {
	const durableMeaning: Json.Serializable = {
		actor: operation.actor,
		dependencies: operation.dependencies,
		group: operation.group,
		id: operation.id,
		model: operation.model,
		operation: operation.operation,
		protocolVersion: operation.protocolVersion,
		atom: operation.atom,
		session: operation.session,
	}
	return createHash(`sha256`).update(canonicalize(durableMeaning)).digest(`hex`)
}

const schemaReason = (issues: readonly StandardSchemaV1.Issue[]): string =>
	issues.map(({ message }) => message).join(`; `) || `Schema validation failed.`

/**
 * Create a durable, server-authoritative Mosaic operation service.
 *
 * One instance may cache projections, but the storage adapter owns ordering.
 * Head watches are only wake-up hints; every wake-up drains a checked,
 * contiguous recovery result from the linearizable store.
 */
export function createMosaicServer(options: MosaicServerOptions): MosaicServer {
	const storage = options.storage ?? new InMemoryMosaicStorage()
	const singletonAtoms = new Map<string, ErasedAtom>()
	const atomFamilies = new Map<string, ErasedAtom>()
	for (const atom of options.atoms) {
		const registrations =
			atom.target.type === `mutable_atom` ? singletonAtoms : atomFamilies
		if (
			registrations.has(atom.target.key) ||
			(atom.target.type === `mutable_atom`
				? atomFamilies.has(atom.target.key)
				: singletonAtoms.has(atom.target.key))
		) {
			throw new Error(`Duplicate Mosaic target key "${atom.target.key}"`)
		}
		if (
			atom.checkpointEvery !== undefined &&
			(!Number.isSafeInteger(atom.checkpointEvery) || atom.checkpointEvery < 1)
		) {
			throw new Error(`checkpointEvery must be a positive safe integer`)
		}
		if (
			!isIdentifier(atom.class.mosaic.key) ||
			!Number.isSafeInteger(atom.class.mosaic.version) ||
			atom.class.mosaic.version < 1 ||
			atom.class.timelinePolicy !== `append-only`
		) {
			throw new Error(`A Mosaic transceiver class requires model metadata`)
		}
		registrations.set(atom.target.key, atom)
	}

	const registeredAtom = (
		address: MosaicAtomAddress,
	): ErasedAtom | undefined => {
		if (address.family === undefined) return singletonAtoms.get(address.key)
		return atomFamilies.get(address.family.key)
	}

	const runtimes = new Map<string, AtomRuntime>()
	const connections = new Set<ConnectionState>()
	const presence = new Map<string, Map<string, PresenceRecord>>()
	let disposed = false

	const runtimeFor = (
		atom: ErasedAtom,
		address: MosaicAtomAddress,
	): AtomRuntime => {
		const key = mosaicAtomAddressKey(address)
		let runtime = runtimes.get(key)
		if (runtime === undefined) {
			runtime = {
				address,
				checkpointTail: Promise.resolve(),
				disposeWatch: undefined,
				headRevision: 0,
				initialized: false,
				receiptIds: new Set(),
				atom,
				retentionEpoch: 0,
				tail: Promise.resolve(),
				transceiver: new atom.class(),
			}
			runtimes.set(key, runtime)
		}
		return runtime
	}

	const enqueue = <Value>(
		runtime: AtomRuntime,
		operation: () => Promise<Value>,
	): Promise<Value> => {
		const result = runtime.tail.then(operation, operation)
		runtime.tail = result.then(
			() => {},
			() => {},
		)
		return result
	}

	const assertRecovery = (
		runtime: AtomRuntime,
		recovery: MosaicStorageRecovery,
	): void => {
		if (recovery.checkpoint !== null) {
			if (
				recovery.checkpoint.protocolVersion !== MOSAIC_PROTOCOL_VERSION ||
				!sameAtom(recovery.checkpoint.atom, runtime.address) ||
				!matchesModel(recovery.checkpoint.model, runtime.atom.class.mosaic)
			) {
				throw new Error(
					`Mosaic checkpoint for "${runtime.address.key}" uses an incompatible protocol or model`,
				)
			}
		}
		let expected = (recovery.checkpoint?.revision ?? 0) + 1
		for (const accepted of recovery.tail) {
			if (
				accepted.revision !== expected ||
				!sameAtom(accepted.operation.atom, runtime.address) ||
				accepted.operation.protocolVersion !== MOSAIC_PROTOCOL_VERSION ||
				!matchesModel(accepted.operation.model, runtime.atom.class.mosaic)
			) {
				throw new Error(
					`Mosaic recovery for "${runtime.address.key}" is incompatible or non-contiguous at revision ${expected}`,
				)
			}
			expected++
		}
		if (expected - 1 !== recovery.headRevision) {
			throw new Error(
				`Mosaic recovery for "${runtime.address.key}" ended at ${expected - 1}, expected ${recovery.headRevision}`,
			)
		}
	}

	const applyAccepted = (
		runtime: AtomRuntime,
		accepted: MosaicAcceptedOperationEnvelope,
	): void => {
		if (accepted.revision !== runtime.headRevision + 1) {
			throw new Error(
				`Cannot apply Mosaic revision ${accepted.revision} after ${runtime.headRevision}`,
			)
		}
		const operation = accepted.operation
		runtime.transceiver.do({
			actor: operation.actor,
			dependencies: operation.dependencies,
			group: operation.group,
			id: operation.id,
			operation: operation.operation,
			revision: accepted.revision,
			session: operation.session,
		})
		runtime.headRevision = accepted.revision
		runtime.receiptIds.add(operation.id)
	}

	const drain = async (
		runtime: AtomRuntime,
		broadcastChanges = false,
	): Promise<void> => {
		const before = runtime.headRevision
		const recovery = await storage.recover(runtime.address)
		assertRecovery(runtime, recovery)
		const checkpointRevision = recovery.checkpoint?.revision ?? 0
		if (!runtime.initialized || checkpointRevision > runtime.headRevision) {
			runtime.transceiver = recovery.checkpoint
				? runtime.atom.class.fromJSON(recovery.checkpoint.snapshot)
				: new runtime.atom.class()
			runtime.headRevision = checkpointRevision
			runtime.receiptIds = new Set(recovery.receiptIds)
			runtime.initialized = true
		}
		for (const accepted of recovery.tail) {
			if (accepted.revision > runtime.headRevision)
				applyAccepted(runtime, accepted)
		}
		runtime.receiptIds = new Set(recovery.receiptIds)
		runtime.retentionEpoch = recovery.retentionEpoch
		if (!broadcastChanges || runtime.headRevision <= before) return
		if (checkpointRevision > before) {
			for (const connection of connections) {
				if (connection.joined.has(mosaicAtomAddressKey(runtime.address))) {
					emit(
						connection,
						MOSAIC_EVENTS.snapshot,
						snapshotFor(runtime, [], connection.session),
					)
				}
			}
			return
		}
		for (const accepted of recovery.tail) {
			if (accepted.revision > before) {
				broadcastAccepted(runtime.address, accepted)
			}
		}
	}

	const initialize = async (runtime: AtomRuntime): Promise<void> => {
		if (runtime.initialized) return
		await drain(runtime)
		if (runtime.disposeWatch === undefined && storage.watchHead !== undefined) {
			runtime.disposeWatch = await storage.watchHead(runtime.address, (hint) => {
				if (hint.revision <= runtime.headRevision || disposed) return
				void enqueue(runtime, async () => {
					await drain(runtime, true)
				})
			})
		}
	}

	const emit = (
		connection: ConnectionState,
		event: string,
		payload: Json.Serializable,
	): void => {
		if (!connection.disposed) connection.socket.emit(event, payload)
	}

	const reject = (
		connection: ConnectionState,
		rejection: RejectionOptions,
	): void => {
		const envelope: MosaicRejectionEnvelope = {
			code: rejection.code,
			operationId: rejection.operationId ?? null,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			reason: rejection.reason,
			recovery: rejection.recovery,
			atom: rejection.atom,
			session: connection.session,
		}
		emit(connection, MOSAIC_EVENTS.rejection, envelope)
	}

	function broadcastAccepted(
		atom: MosaicAtomAddress,
		accepted: MosaicAcceptedOperationEnvelope,
	): void {
		for (const connection of connections) {
			if (connection.joined.has(mosaicAtomAddressKey(atom))) {
				emit(connection, MOSAIC_EVENTS.operation, accepted)
			}
		}
	}

	const broadcastPresence = (
		atom: MosaicAtomAddress,
		envelope: MosaicPresenceEnvelope<Json.Serializable | null>,
	): void => {
		for (const connection of connections) {
			if (connection.joined.has(mosaicAtomAddressKey(atom))) {
				emit(connection, MOSAIC_EVENTS.presence, envelope)
			}
		}
	}

	const isAuthorized = async (
		context: MosaicAuthorizationContext,
	): Promise<boolean> => (await options.authorize?.(context)) ?? true

	const checkpointRuntime = async (runtime: AtomRuntime): Promise<boolean> => {
		await initialize(runtime)
		await drain(runtime)
		const checkpoint = {
			atom: runtime.address,
			model: runtime.atom.class.mosaic,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			revision: runtime.headRevision,
			snapshot: runtime.transceiver.toJSON(),
		}
		const result = await storage.checkpoint({
			checkpoint,
			expectedRetentionEpoch: runtime.retentionEpoch,
			expectedRevision: runtime.headRevision,
		})
		if (result.status === `stale`) {
			await drain(runtime)
			return false
		}
		runtime.retentionEpoch = result.retentionEpoch
		return true
	}

	const scheduleCheckpoint = (runtime: AtomRuntime): void => {
		const every = runtime.atom.checkpointEvery
		if (every === undefined || runtime.headRevision % every !== 0) return
		runtime.checkpointTail = runtime.checkpointTail.then(async () => {
			await enqueue(runtime, () => checkpointRuntime(runtime))
		})
	}

	const snapshotFor = (
		runtime: AtomRuntime,
		pendingOperationIds: readonly string[],
		session: string,
	): MosaicSnapshotEnvelope => ({
		acceptedPendingOperationIds: pendingOperationIds.filter((id) =>
			runtime.receiptIds.has(id),
		),
		atom: runtime.address,
		model: runtime.atom.class.mosaic,
		protocolVersion: MOSAIC_PROTOCOL_VERSION,
		revision: runtime.headRevision,
		session,
		snapshot: runtime.transceiver.toJSON(),
	})

	const parseJoin = (payload: unknown): MosaicJoinEnvelope | null => {
		if (!isRecord(payload)) return null
		const knownRevision = payload[`knownRevision`]
		const pendingOperationIds = payload[`pendingOperationIds`]
		if (
			payload[`protocolVersion`] !== MOSAIC_PROTOCOL_VERSION ||
			parseAtomAddress(payload[`atom`]) === null ||
			!isIdentifier(payload[`session`]) ||
			(knownRevision !== null &&
				(typeof knownRevision !== `number` ||
					!Number.isSafeInteger(knownRevision) ||
					knownRevision < 0)) ||
			!Array.isArray(pendingOperationIds) ||
			pendingOperationIds.length > 10_000 ||
			!pendingOperationIds.every((id) => isIdentifier(id))
		) {
			return null
		}
		return payload as MosaicJoinEnvelope
	}

	const parseProposal = (payload: unknown): MosaicOperationProposal | null => {
		if (!isRecord(payload)) return null
		const dependencies = payload[`dependencies`]
		if (
			payload[`protocolVersion`] !== MOSAIC_PROTOCOL_VERSION ||
			parseAtomAddress(payload[`atom`]) === null ||
			!isIdentifier(payload[`session`]) ||
			!isIdentifier(payload[`id`]) ||
			(payload[`group`] !== null && !isIdentifier(payload[`group`])) ||
			!Array.isArray(dependencies) ||
			dependencies.length > 10_000 ||
			!dependencies.every((id) => isIdentifier(id)) ||
			new Set(dependencies).size !== dependencies.length ||
			dependencies.includes(payload[`id`]) ||
			!(`operation` in payload)
		) {
			return null
		}
		return payload as MosaicOperationProposal
	}

	const join = async (
		connection: ConnectionState,
		payload: unknown,
	): Promise<void> => {
		const request = parseJoin(payload)
		const fallbackAtom = atomFromPayload(payload)
		if (
			isRecord(payload) &&
			payload[`protocolVersion`] !== MOSAIC_PROTOCOL_VERSION
		) {
			reject(connection, {
				code: `incompatible-version`,
				reason: `The Mosaic protocol version is incompatible.`,
				recovery: `upgrade`,
				atom: fallbackAtom,
			})
			return
		}
		if (request === null) {
			reject(connection, {
				code: `invalid-payload`,
				reason: `Malformed Mosaic join request.`,
				recovery: `discard-operation`,
				atom: fallbackAtom,
			})
			return
		}
		const address = request.atom
		const atom = registeredAtom(address)
		if (atom === undefined) {
			reject(connection, {
				code: `atom-unavailable`,
				reason: `That Mosaic atom is unavailable.`,
				recovery: `none`,
				atom: request.atom,
			})
			return
		}
		if (!matchesModel(request.model, atom.class.mosaic)) {
			reject(connection, {
				code: `incompatible-version`,
				reason: `The Mosaic model version is incompatible.`,
				recovery: `upgrade`,
				atom: request.atom,
			})
			return
		}
		if (request.session !== connection.session) {
			reject(connection, {
				code: `unauthorized`,
				reason: `The authenticated session does not own this request.`,
				recovery: `none`,
				atom: request.atom,
			})
			return
		}
		// Read authorization deliberately precedes all persistence access.
		if (
			!(await isAuthorized({
				action: `read`,
				actor: connection.actor,
				atom: request.atom,
				session: connection.session,
			}))
		) {
			reject(connection, {
				code: `unauthorized`,
				reason: `Not authorized to read this Mosaic atom.`,
				recovery: `none`,
				atom: request.atom,
			})
			return
		}
		const runtime = runtimeFor(atom, address)
		await enqueue(runtime, async () => {
			await initialize(runtime)
			await drain(runtime)
			connection.joined.add(mosaicAtomAddressKey(address))
			await storage.setSessionWatermark(
				request.atom,
				connection.session,
				request.knownRevision ?? 0,
			)
			emit(
				connection,
				MOSAIC_EVENTS.snapshot,
				snapshotFor(runtime, request.pendingOperationIds, connection.session),
			)
		})
		for (const record of presence.get(mosaicAtomAddressKey(address))?.values() ??
			[]) {
			const envelope: MosaicPresenceEnvelope = {
				actor: record.connection.actor,
				presence: record.presence,
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				atom: request.atom,
				session: record.connection.session,
			}
			emit(connection, MOSAIC_EVENTS.presence, envelope)
		}
	}

	const validateHistory = (
		runtime: AtomRuntime,
		operation: Json.Serializable,
		actor: string,
	): string | null => {
		const request = historyRequest(operation)
		if (request === null) return null
		const view = runtime.transceiver.READONLY_VIEW as {
			readonly historyFor?: (actor: string) => MosaicHistoryTimeline
		}
		const actorTimeline = view.historyFor?.(actor)
		if (actorTimeline === undefined) {
			return `This Mosaic transceiver does not expose selective history.`
		}
		const expected = actorTimeline[request.mode].at(-1)
		return expected !== undefined &&
			sameStrings(expected.targetOperationIds, request.targetOperationIds)
			? null
			: `The selective history cursor moved; resnapshot and try again.`
	}

	const propose = async (
		connection: ConnectionState,
		payload: unknown,
	): Promise<void> => {
		const proposal = parseProposal(payload)
		const fallbackAtom = atomFromPayload(payload)
		const operationId =
			isRecord(payload) && isIdentifier(payload[`id`]) ? payload[`id`] : null
		if (
			isRecord(payload) &&
			payload[`protocolVersion`] !== MOSAIC_PROTOCOL_VERSION
		) {
			reject(connection, {
				code: `incompatible-version`,
				operationId,
				reason: `The Mosaic protocol version is incompatible.`,
				recovery: `upgrade`,
				atom: fallbackAtom,
			})
			return
		}
		if (proposal === null) {
			reject(connection, {
				code: `invalid-payload`,
				operationId,
				reason: `Malformed Mosaic operation proposal.`,
				recovery: `discard-operation`,
				atom: fallbackAtom,
			})
			return
		}
		const address = proposal.atom
		const atom = registeredAtom(address)
		if (
			atom === undefined ||
			!connection.joined.has(mosaicAtomAddressKey(address)) ||
			!matchesModel(proposal.model, atom.class.mosaic)
		) {
			reject(connection, {
				code: atom === undefined ? `atom-unavailable` : `incompatible-version`,
				operationId: proposal.id,
				reason: `Join a compatible Mosaic atom before proposing operations.`,
				recovery: `resnapshot`,
				atom: proposal.atom,
			})
			return
		}
		if (proposal.session !== connection.session) {
			reject(connection, {
				code: `unauthorized`,
				operationId: proposal.id,
				reason: `The authenticated session does not own this proposal.`,
				recovery: `discard-operation`,
				atom: proposal.atom,
			})
			return
		}

		const schemaResult = await atom.operationSchema[`~standard`].validate(
			proposal.operation,
		)
		if (schemaResult.issues !== undefined) {
			reject(connection, {
				code: `invalid-model-operation`,
				operationId: proposal.id,
				reason: schemaReason(schemaResult.issues),
				recovery: `discard-operation`,
				atom: proposal.atom,
			})
			return
		}
		// The schema is the trust boundary before operation-level authorization.
		if (
			!(await isAuthorized({
				action: `propose`,
				actor: connection.actor,
				operation: schemaResult.value,
				atom: proposal.atom,
				session: connection.session,
			}))
		) {
			reject(connection, {
				code: `unauthorized`,
				operationId: proposal.id,
				reason: `Not authorized to edit this Mosaic atom.`,
				recovery: `discard-operation`,
				atom: proposal.atom,
			})
			return
		}

		const runtime = runtimeFor(atom, address)
		await enqueue(runtime, async () => {
			for (let attempt = 0; attempt < 8; attempt++) {
				await initialize(runtime)
				await drain(runtime, true)
				const authenticated: MosaicOperationEnvelope = {
					...proposal,
					actor: connection.actor,
					operation: schemaResult.value,
					session: connection.session,
				}
				const proposalFingerprint = fingerprintMosaicOperation(authenticated)
				const existing = await storage.receipt(
					authenticated.atom,
					authenticated.id,
				)
				if (existing !== null) {
					if (existing.fingerprint === proposalFingerprint) {
						emit(connection, MOSAIC_EVENTS.operation, existing.accepted)
						await storage.setSessionWatermark(
							authenticated.atom,
							connection.session,
							existing.accepted.revision,
						)
						return
					}
					reject(connection, {
						code: `operation-id-collision`,
						operationId: authenticated.id,
						reason: `That operation id was already used for different content.`,
						recovery: `discard-operation`,
						atom: authenticated.atom,
					})
					return
				}
				const missing = authenticated.dependencies.filter(
					(id) => !runtime.receiptIds.has(id),
				)
				if (missing.length > 0) {
					reject(connection, {
						code: `missing-dependency`,
						operationId: authenticated.id,
						reason: `Missing dependencies: ${missing.join(`, `)}.`,
						recovery: `retry`,
						atom: authenticated.atom,
					})
					return
				}
				const validationContext = {
					actor: authenticated.actor,
					dependencies: authenticated.dependencies,
					group: authenticated.group,
					id: authenticated.id,
					revision: runtime.headRevision + 1,
					session: authenticated.session,
				}
				const historyFailure = validateHistory(
					runtime,
					authenticated.operation,
					authenticated.actor,
				)
				if (historyFailure !== null) {
					reject(connection, {
						code: `stale-history`,
						operationId: authenticated.id,
						reason: historyFailure,
						recovery: `resnapshot`,
						atom: authenticated.atom,
					})
					return
				}
				const decision = runtime.transceiver.validate(
					authenticated.operation,
					validationContext,
				)
				if (decision.status === `defer`) {
					reject(connection, {
						code: `missing-dependency`,
						operationId: authenticated.id,
						reason: `The model deferred this operation pending: ${decision.dependencies.join(`, `)}.`,
						recovery: `retry`,
						atom: authenticated.atom,
					})
					return
				}
				if (decision.status === `reject`) {
					reject(connection, {
						code: `invalid-model-operation`,
						operationId: authenticated.id,
						reason: decision.reason,
						recovery: `discard-operation`,
						atom: authenticated.atom,
					})
					return
				}
				const normalized: MosaicOperationEnvelope = {
					...authenticated,
					operation: decision.operation,
				}
				const accepted: MosaicAcceptedOperationEnvelope = {
					operation: normalized,
					revision: runtime.headRevision + 1,
				}
				const result = await storage.append({
					accepted,
					expectedRevision: runtime.headRevision,
					fingerprint: proposalFingerprint,
				})
				if (result.status === `stale`) continue
				if (result.status === `collision`) {
					reject(connection, {
						code: `operation-id-collision`,
						operationId: normalized.id,
						reason: `That operation id was already used for different content.`,
						recovery: `discard-operation`,
						atom: normalized.atom,
					})
					return
				}
				if (result.status === `duplicate`) {
					emit(connection, MOSAIC_EVENTS.operation, result.accepted)
					await storage.setSessionWatermark(
						normalized.atom,
						connection.session,
						result.accepted.revision,
					)
					return
				}
				applyAccepted(runtime, result.accepted)
				await storage.setSessionWatermark(
					normalized.atom,
					connection.session,
					result.accepted.revision,
				)
				broadcastAccepted(normalized.atom, result.accepted)
				scheduleCheckpoint(runtime)
				return
			}
			reject(connection, {
				code: `atom-unavailable`,
				operationId: proposal.id,
				reason: `The Mosaic stream remained contended; retry the proposal.`,
				recovery: `retry`,
				atom: proposal.atom,
			})
		})
	}

	const updatePresence = async (
		connection: ConnectionState,
		payload: unknown,
	): Promise<void> => {
		if (
			!isRecord(payload) ||
			payload[`protocolVersion`] !== MOSAIC_PROTOCOL_VERSION ||
			parseAtomAddress(payload[`atom`]) === null ||
			!isIdentifier(payload[`session`])
		) {
			return
		}
		const proposal = payload as MosaicPresenceProposal
		const address = proposal.atom
		const atom = registeredAtom(address)
		if (
			atom?.presenceSchema === undefined ||
			proposal.session !== connection.session ||
			!connection.joined.has(mosaicAtomAddressKey(address))
		) {
			return
		}
		if (proposal.presence === null) {
			if (
				!(await isAuthorized({
					action: `presence`,
					actor: connection.actor,
					operation: null,
					atom: proposal.atom,
					session: connection.session,
				}))
			) {
				return
			}
			const addressKey = mosaicAtomAddressKey(address)
			const records = presence.get(addressKey)
			if (records?.delete(connection.session)) {
				broadcastPresence(proposal.atom, {
					actor: connection.actor,
					presence: null,
					protocolVersion: MOSAIC_PROTOCOL_VERSION,
					atom: proposal.atom,
					session: connection.session,
				})
			}
			if (records?.size === 0) presence.delete(addressKey)
			return
		}
		const validation = await atom.presenceSchema[`~standard`].validate(
			proposal.presence,
		)
		if (validation.issues !== undefined) return
		if (
			!(await isAuthorized({
				action: `presence`,
				actor: connection.actor,
				operation: validation.value,
				atom: proposal.atom,
				session: connection.session,
			}))
		) {
			return
		}
		const addressKey = mosaicAtomAddressKey(address)
		const records = presence.get(addressKey) ?? new Map()
		const runtime = runtimeFor(atom, address)
		await enqueue(runtime, async () => {
			await initialize(runtime)
			await drain(runtime, true)
			if (
				atom.validatePresence !== undefined &&
				!(await atom.validatePresence(validation.value, {
					actor: connection.actor,
					atom: proposal.atom,
					session: connection.session,
					view: runtime.transceiver.READONLY_VIEW,
				}))
			) {
				return
			}
			records.set(connection.session, {
				connection,
				presence: validation.value,
			})
			presence.set(addressKey, records)
			broadcastPresence(proposal.atom, {
				actor: connection.actor,
				presence: validation.value,
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				atom: proposal.atom,
				session: connection.session,
			})
		})
	}

	const disconnect = async (connection: ConnectionState): Promise<void> => {
		if (connection.disposed) return
		connection.disposed = true
		for (const [event, listener] of connection.listeners) {
			connection.socket.off(event, listener)
		}
		connections.delete(connection)
		for (const atomKey of connection.joined) {
			const address = runtimes.get(atomKey)?.address
			if (address === undefined) continue
			await storage.clearSession(address, connection.session)
			const records = presence.get(atomKey)
			if (records?.delete(connection.session)) {
				broadcastPresence(address, {
					actor: connection.actor,
					presence: null,
					protocolVersion: MOSAIC_PROTOCOL_VERSION,
					atom: address,
					session: connection.session,
				})
			}
			if (records?.size === 0) presence.delete(atomKey)
		}
	}

	return {
		checkpoint: async (address): Promise<boolean> => {
			const atom = registeredAtom(address)
			if (atom === undefined) return false
			const runtime = runtimeFor(atom, address)
			return enqueue(runtime, () => checkpointRuntime(runtime))
		},
		connect: (input): (() => Promise<void>) => {
			if (disposed) throw new Error(`This Mosaic server has been disposed`)
			if (!isIdentifier(input.actor) || !isIdentifier(input.session)) {
				throw new Error(`Mosaic connections require an actor and session`)
			}
			const connection: ConnectionState = {
				...input,
				disposed: false,
				joined: new Set(),
				listeners: [],
			}
			const listen = (
				event: string,
				handler: (payload: unknown) => Promise<void>,
			): void => {
				const listener = (...args: Json.Serializable[]): void => {
					void handler(args[0]).catch(() => {
						reject(connection, {
							code: `atom-unavailable`,
							reason: `The Mosaic server could not process that request.`,
							recovery: `retry`,
							atom: atomFromPayload(args[0]),
						})
					})
				}
				input.socket.on(event, listener)
				connection.listeners.push([event, listener])
			}
			listen(MOSAIC_EVENTS.join, (payload) => join(connection, payload))
			listen(MOSAIC_EVENTS.operation, (payload) => propose(connection, payload))
			listen(MOSAIC_EVENTS.presence, (payload) =>
				updatePresence(connection, payload),
			)
			connections.add(connection)
			return () => disconnect(connection)
		},
		dispose: async (): Promise<void> => {
			if (disposed) return
			disposed = true
			await Promise.all(
				[...connections].map((connection) => disconnect(connection)),
			)
			for (const runtime of runtimes.values()) {
				runtime.disposeWatch?.()
				await runtime.tail
				await runtime.checkpointTail
			}
		},
		atomStatus: (address): MosaicServerAtomStatus => {
			const runtime = runtimes.get(mosaicAtomAddressKey(address))
			return {
				initialized: runtime?.initialized ?? false,
				revision: runtime?.headRevision ?? 0,
			}
		},
	}
}

/** Preserve transceiver, schema and presence inference for one atom target. */
export function defineMosaicServerAtom<
	T extends AnyMosaicTransceiver,
	Presence extends Json.Serializable = Json.Serializable,
>(atom: MosaicServerAtom<T, Presence>): MosaicServerAtom<T, Presence> {
	return atom
}

/** Extract the transceiver's JSON-safe durable checkpoint type. */
export type MosaicServerSnapshot<T extends AnyMosaicTransceiver> =
	MosaicSnapshot<T>
