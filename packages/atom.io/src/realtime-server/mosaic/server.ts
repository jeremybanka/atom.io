import { createHash } from "node:crypto"

import type { MutableAtomFamilyToken, MutableAtomToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { type Json, stringifyJson } from "atom.io/foundations/json"
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

export type MosaicServerTarget<
	T extends AnyMosaicTransceiver,
	Key extends Canonical = Canonical,
> = MutableAtomToken<T> | MutableAtomFamilyToken<T, Key>

type MosaicAtomRegistrationBase<
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
	/** Perform model-aware checks such as validating relative anchors. */
	readonly validatePresence?: (
		presence: Presence,
		context: MosaicPresenceContext<T[`READONLY_VIEW`]>,
	) => MaybePromise<boolean>
}

export type MosaicAtomRegistration<
	T extends AnyMosaicTransceiver,
	Presence extends Json.Serializable = Json.Serializable,
	Key extends Canonical = Canonical,
> = MosaicAtomRegistrationBase<T, Presence> &
	(
		| {
				/** Validate every dynamic key before opening a family-member stream. */
				readonly keySchema: StandardSchemaV1<unknown, Key>
				readonly target: MutableAtomFamilyToken<T, Key>
		  }
		| {
				readonly keySchema?: never
				/** Register one standalone atom or concrete family-member token. */
				readonly target: MutableAtomToken<T>
		  }
	)

export type MosaicServerConnection = {
	readonly actor: string
	readonly session: string
	readonly socket: Socket
}

/** Internal erasure that preserves heterogeneous registration inference. */
type ErasedRegistration = {
	readonly checkpointEvery?: number
	readonly class: MosaicTransceiverClass
	readonly keySchema?: StandardSchemaV1<unknown, Canonical>
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
	readonly registrations: readonly ErasedRegistration[]
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
	atomStatus(atom: MosaicAtomAddress): Promise<MosaicServerAtomStatus>
}

type AtomRuntime = {
	checkpointTail: Promise<void>
	disposeWatch: (() => void) | undefined
	headRevision: number
	initialized: boolean
	receiptIds: Set<string>
	address: MosaicAtomAddress
	headOperationIds: Set<string>
	registration: ErasedRegistration
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

type ParsedAtomAddress = {
	readonly address: MosaicAtomAddress
	readonly familyKey?: Canonical
}

type ResolvedRegistration = {
	readonly address: MosaicAtomAddress
	readonly registration: ErasedRegistration
}

const isCanonical = (value: unknown): value is Canonical =>
	value === null ||
	typeof value === `boolean` ||
	typeof value === `number` ||
	typeof value === `string` ||
	(Array.isArray(value) && value.every(isCanonical))

const parseAtomAddress = (value: unknown): ParsedAtomAddress | null => {
	if (
		!isRecord(value) ||
		value[`type`] !== `mutable_atom` ||
		!isIdentifier(value[`key`])
	) {
		return null
	}
	const family = value[`family`]
	if (family === undefined) {
		return { address: { key: value[`key`], type: `mutable_atom` } }
	}
	if (
		!isRecord(family) ||
		!isIdentifier(family[`key`]) ||
		!isIdentifier(family[`subKey`]) ||
		value[`key`] !== `${family[`key`]}(${family[`subKey`]})`
	) {
		return null
	}
	let familyKey: unknown
	try {
		familyKey = JSON.parse(family[`subKey`])
	} catch {
		return null
	}
	if (!isCanonical(familyKey)) return null
	const subKey = stringifyJson(familyKey)
	return {
		address: {
			family: { key: family[`key`], subKey },
			key: `${family[`key`]}(${subKey})`,
			type: `mutable_atom`,
		},
		familyKey,
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
		? (parseAtomAddress(payload[`atom`])?.address ?? unknownAtom)
		: unknownAtom

const matchesModel = (
	actual: unknown,
	expected: MosaicTransceiverConstructor[`mosaic`],
): boolean => {
	if (
		!isRecord(actual) ||
		actual[`key`] !== expected.key ||
		actual[`version`] !== expected.version
	) {
		return false
	}
	const actualHasConfiguration = Object.hasOwn(actual, `configuration`)
	const expectedHasConfiguration = Object.hasOwn(expected, `configuration`)
	if (actualHasConfiguration !== expectedHasConfiguration) return false
	if (!actualHasConfiguration) return true
	try {
		return (
			canonicalize(actual[`configuration`] as Json.Serializable) ===
			canonicalize(expected.configuration as Json.Serializable)
		)
	} catch {
		return false
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
	const exactRegistrations = new Map<string, ErasedRegistration>()
	const familyRegistrations = new Map<string, ErasedRegistration>()
	for (const registration of options.registrations) {
		const key =
			registration.target.type === `mutable_atom`
				? mosaicAtomAddressKey({
						...(registration.target.family === undefined
							? {}
							: { family: registration.target.family }),
						key: registration.target.key,
						type: `mutable_atom`,
					})
				: registration.target.key
		const registrations =
			registration.target.type === `mutable_atom`
				? exactRegistrations
				: familyRegistrations
		if (registrations.has(key)) {
			throw new Error(
				`Duplicate Mosaic registration "${registration.target.key}"`,
			)
		}
		if (
			registration.checkpointEvery !== undefined &&
			(!Number.isSafeInteger(registration.checkpointEvery) ||
				registration.checkpointEvery < 1)
		) {
			throw new Error(`checkpointEvery must be a positive safe integer`)
		}
		if (
			!isIdentifier(registration.class.mosaic.key) ||
			!Number.isSafeInteger(registration.class.mosaic.version) ||
			registration.class.mosaic.version < 1 ||
			registration.class.timelinePolicy !== `append-only`
		) {
			throw new Error(`A Mosaic transceiver class requires model metadata`)
		}
		if (
			registration.target.type === `mutable_atom_family` &&
			registration.keySchema === undefined
		) {
			throw new Error(`A Mosaic atom family registration requires a key schema`)
		}
		registrations.set(key, registration)
	}
	for (const [key, registration] of exactRegistrations) {
		if (
			registration.target.type === `mutable_atom` &&
			registration.target.family !== undefined &&
			familyRegistrations.has(registration.target.family.key)
		) {
			throw new Error(
				`Mosaic registration "${key}" overlaps family "${registration.target.family.key}"`,
			)
		}
	}

	const resolveRegistration = async (
		parsed: ParsedAtomAddress,
	): Promise<ResolvedRegistration | undefined> => {
		const exact = exactRegistrations.get(mosaicAtomAddressKey(parsed.address))
		if (exact !== undefined) {
			return { address: parsed.address, registration: exact }
		}
		if (parsed.address.family === undefined || parsed.familyKey === undefined) {
			return undefined
		}
		const family = familyRegistrations.get(parsed.address.family.key)
		if (family?.keySchema === undefined) return undefined
		const result = await family.keySchema[`~standard`].validate(parsed.familyKey)
		if (result.issues !== undefined || !isCanonical(result.value))
			return undefined
		const subKey = stringifyJson(result.value)
		return {
			address: {
				family: { key: parsed.address.family.key, subKey },
				key: `${parsed.address.family.key}(${subKey})`,
				type: `mutable_atom`,
			},
			registration: family,
		}
	}

	const runtimes = new Map<string, AtomRuntime>()
	const connections = new Set<ConnectionState>()
	const presence = new Map<string, Map<string, PresenceRecord>>()
	let disposed = false

	const runtimeFor = (
		registration: ErasedRegistration,
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
				headOperationIds: new Set(),
				registration,
				retentionEpoch: 0,
				tail: Promise.resolve(),
				transceiver: new registration.class(),
			}
			runtimes.set(key, runtime)
		}
		return runtime
	}

	const enqueue = <Value>(
		runtime: AtomRuntime,
		operation: () => MaybePromise<Value>,
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
			const heads: unknown = recovery.checkpoint.headOperationIds
			if (
				recovery.checkpoint.protocolVersion !== MOSAIC_PROTOCOL_VERSION ||
				!sameAtom(recovery.checkpoint.atom, runtime.address) ||
				!matchesModel(
					recovery.checkpoint.model,
					runtime.registration.class.mosaic,
				) ||
				!Array.isArray(heads) ||
				!heads.every((id) => isIdentifier(id)) ||
				new Set(heads).size !== heads.length ||
				heads.some((id) => !recovery.receiptIds.includes(id))
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
				!matchesModel(
					accepted.operation.model,
					runtime.registration.class.mosaic,
				)
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

	const preflightAccepted = (
		runtime: AtomRuntime,
		accepted: MosaicAcceptedOperationEnvelope,
	): AnyMosaicTransceiver => {
		if (accepted.revision !== runtime.headRevision + 1) {
			throw new Error(
				`Cannot apply Mosaic revision ${accepted.revision} after ${runtime.headRevision}`,
			)
		}
		const operation = accepted.operation
		const next = runtime.registration.class.fromJSON(
			runtime.transceiver.toJSON(),
		)
		const result: unknown = next.do({
			actor: operation.actor,
			dependencies: operation.dependencies,
			group: operation.group,
			id: operation.id,
			operation: operation.operation,
			revision: accepted.revision,
			session: operation.session,
		})
		if (result !== null) {
			throw new Error(
				`Mosaic operation "${operation.id}" did not apply atomically`,
			)
		}
		return next
	}

	const commitAccepted = (
		runtime: AtomRuntime,
		accepted: MosaicAcceptedOperationEnvelope,
		transceiver: AnyMosaicTransceiver,
	): void => {
		const operation = accepted.operation
		runtime.transceiver = transceiver
		runtime.headRevision = accepted.revision
		runtime.receiptIds.add(operation.id)
		for (const dependency of operation.dependencies) {
			runtime.headOperationIds.delete(dependency)
		}
		runtime.headOperationIds.add(operation.id)
	}

	const applyAccepted = (
		runtime: AtomRuntime,
		accepted: MosaicAcceptedOperationEnvelope,
	): void => {
		commitAccepted(runtime, accepted, preflightAccepted(runtime, accepted))
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
				? runtime.registration.class.fromJSON(recovery.checkpoint.snapshot)
				: new runtime.registration.class()
			runtime.headRevision = checkpointRevision
			runtime.headOperationIds = new Set(
				recovery.checkpoint?.headOperationIds ?? [],
			)
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

	const removePresence = (
		connection: ConnectionState,
		atom: MosaicAtomAddress,
	): void => {
		const atomKey = mosaicAtomAddressKey(atom)
		const records = presence.get(atomKey)
		if (records?.delete(connection.session)) {
			broadcastPresence(atom, {
				actor: connection.actor,
				presence: null,
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				atom,
				session: connection.session,
			})
		}
		if (records?.size === 0) presence.delete(atomKey)
	}

	const isAuthorized = async (
		context: MosaicAuthorizationContext,
	): Promise<boolean> => (await options.authorize?.(context)) ?? true

	const checkpointRuntime = async (runtime: AtomRuntime): Promise<boolean> => {
		await initialize(runtime)
		await drain(runtime)
		const checkpoint = {
			atom: runtime.address,
			headOperationIds: [...runtime.headOperationIds].sort(),
			model: runtime.registration.class.mosaic,
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
		const every = runtime.registration.checkpointEvery
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
		headOperationIds: [...runtime.headOperationIds].sort(),
		model: runtime.registration.class.mosaic,
		protocolVersion: MOSAIC_PROTOCOL_VERSION,
		revision: runtime.headRevision,
		session,
		snapshot: runtime.transceiver.toJSON(),
	})

	const parseJoin = (payload: unknown): MosaicJoinEnvelope | null => {
		if (!isRecord(payload)) return null
		const parsedAtom = parseAtomAddress(payload[`atom`])
		const knownRevision = payload[`knownRevision`]
		const pendingOperationIds = payload[`pendingOperationIds`]
		if (
			payload[`protocolVersion`] !== MOSAIC_PROTOCOL_VERSION ||
			parsedAtom === null ||
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
		return {
			atom: parsedAtom.address,
			knownRevision,
			model: payload[`model`] as MosaicJoinEnvelope[`model`],
			pendingOperationIds: [...pendingOperationIds] as string[],
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			session: payload[`session`],
		}
	}

	const parseProposal = (payload: unknown): MosaicOperationProposal | null => {
		if (!isRecord(payload)) return null
		const parsedAtom = parseAtomAddress(payload[`atom`])
		const dependencies = payload[`dependencies`]
		if (
			payload[`protocolVersion`] !== MOSAIC_PROTOCOL_VERSION ||
			parsedAtom === null ||
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
		return {
			atom: parsedAtom.address,
			dependencies: [...dependencies] as string[],
			group: payload[`group`],
			id: payload[`id`],
			model: payload[`model`] as MosaicOperationProposal[`model`],
			operation: payload[`operation`] as Json.Serializable,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			session: payload[`session`],
		}
	}

	const parsePresence = (payload: unknown): MosaicPresenceProposal | null => {
		if (!isRecord(payload)) return null
		const parsedAtom = parseAtomAddress(payload[`atom`])
		if (
			parsedAtom === null ||
			payload[`protocolVersion`] !== MOSAIC_PROTOCOL_VERSION ||
			!isIdentifier(payload[`session`]) ||
			!(`presence` in payload)
		) {
			return null
		}
		return {
			atom: parsedAtom.address,
			presence: payload[`presence`] as Json.Serializable,
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			session: payload[`session`],
		}
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
		const parsedAddress = parseAtomAddress(request.atom)
		const resolved =
			parsedAddress === null
				? undefined
				: await resolveRegistration(parsedAddress)
		if (resolved === undefined) {
			reject(connection, {
				code: `atom-unavailable`,
				reason: `That Mosaic atom is unavailable.`,
				recovery: `none`,
				atom: request.atom,
			})
			return
		}
		const { address, registration } = resolved
		if (!matchesModel(request.model, registration.class.mosaic)) {
			reject(connection, {
				code: `incompatible-version`,
				reason: `The Mosaic model version is incompatible.`,
				recovery: `upgrade`,
				atom: address,
			})
			return
		}
		if (request.session !== connection.session) {
			reject(connection, {
				code: `unauthorized`,
				reason: `The authenticated session does not own this request.`,
				recovery: `none`,
				atom: address,
			})
			return
		}
		// Read authorization deliberately precedes all persistence access.
		if (
			!(await isAuthorized({
				action: `read`,
				actor: connection.actor,
				atom: address,
				session: connection.session,
			}))
		) {
			reject(connection, {
				code: `unauthorized`,
				reason: `Not authorized to read this Mosaic atom.`,
				recovery: `none`,
				atom: address,
			})
			return
		}
		const runtime = runtimeFor(registration, address)
		await enqueue(runtime, async () => {
			await initialize(runtime)
			await drain(runtime)
			connection.joined.add(mosaicAtomAddressKey(address))
			await storage.setSessionWatermark(
				address,
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
				atom: address,
				session: record.connection.session,
			}
			emit(connection, MOSAIC_EVENTS.presence, envelope)
		}
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
		const parsedAddress = parseAtomAddress(proposal.atom)
		const resolved =
			parsedAddress === null
				? undefined
				: await resolveRegistration(parsedAddress)
		if (
			resolved === undefined ||
			!connection.joined.has(
				mosaicAtomAddressKey(resolved?.address ?? proposal.atom),
			) ||
			!matchesModel(proposal.model, resolved.registration.class.mosaic)
		) {
			reject(connection, {
				code:
					resolved === undefined ? `atom-unavailable` : `incompatible-version`,
				operationId: proposal.id,
				reason: `Join a compatible Mosaic atom before proposing operations.`,
				recovery: `resnapshot`,
				atom: resolved?.address ?? proposal.atom,
			})
			return
		}
		const { address, registration } = resolved
		if (proposal.session !== connection.session) {
			reject(connection, {
				code: `unauthorized`,
				operationId: proposal.id,
				reason: `The authenticated session does not own this proposal.`,
				recovery: `discard-operation`,
				atom: address,
			})
			return
		}

		const schemaResult = await registration.operationSchema[
			`~standard`
		].validate(proposal.operation)
		if (schemaResult.issues !== undefined) {
			reject(connection, {
				code: `invalid-model-operation`,
				operationId: proposal.id,
				reason: schemaReason(schemaResult.issues),
				recovery: `discard-operation`,
				atom: address,
			})
			return
		}
		// The schema is the trust boundary before operation-level authorization.
		if (
			!(await isAuthorized({
				action: `propose`,
				actor: connection.actor,
				operation: schemaResult.value,
				atom: address,
				session: connection.session,
			}))
		) {
			reject(connection, {
				code: `unauthorized`,
				operationId: proposal.id,
				reason: `Not authorized to edit this Mosaic atom.`,
				recovery: `discard-operation`,
				atom: address,
			})
			return
		}

		const runtime = runtimeFor(registration, address)
		await enqueue(runtime, async () => {
			for (let attempt = 0; attempt < 8; attempt++) {
				await initialize(runtime)
				await drain(runtime, true)
				const authenticated: MosaicOperationEnvelope = {
					...proposal,
					actor: connection.actor,
					atom: address,
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
						code: decision.code ?? `invalid-model-operation`,
						operationId: authenticated.id,
						reason: decision.reason,
						recovery: decision.recovery ?? `discard-operation`,
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
				// Never durably append an operation that the current projection cannot
				// apply. The clone also becomes the committed projection on success.
				const projected = preflightAccepted(runtime, accepted)
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
				commitAccepted(runtime, result.accepted, projected)
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
				atom: address,
			})
		})
	}

	const updatePresence = async (
		connection: ConnectionState,
		payload: unknown,
	): Promise<void> => {
		const proposal = parsePresence(payload)
		if (proposal === null) return
		const parsedAddress = parseAtomAddress(proposal.atom)
		const resolved =
			parsedAddress === null
				? undefined
				: await resolveRegistration(parsedAddress)
		if (
			resolved?.registration.presenceSchema === undefined ||
			proposal.session !== connection.session ||
			!connection.joined.has(
				mosaicAtomAddressKey(resolved?.address ?? proposal.atom),
			)
		) {
			return
		}
		const { address, registration } = resolved
		const normalizedProposal: MosaicPresenceProposal = {
			...proposal,
			atom: address,
		}
		if (normalizedProposal.presence === null) {
			if (
				!(await isAuthorized({
					action: `presence`,
					actor: connection.actor,
					operation: null,
					atom: address,
					session: connection.session,
				}))
			) {
				return
			}
			const runtime = runtimeFor(registration, address)
			await enqueue(runtime, () => {
				if (connection.disposed) return
				removePresence(connection, address)
			})
			return
		}
		const presenceSchema = registration.presenceSchema
		if (presenceSchema === undefined) return
		const validation = await presenceSchema[`~standard`].validate(
			normalizedProposal.presence,
		)
		if (validation.issues !== undefined) return
		if (
			!(await isAuthorized({
				action: `presence`,
				actor: connection.actor,
				operation: validation.value,
				atom: address,
				session: connection.session,
			}))
		) {
			return
		}
		const runtime = runtimeFor(registration, address)
		await enqueue(runtime, async () => {
			if (connection.disposed) return
			await initialize(runtime)
			await drain(runtime, true)
			if (
				registration.validatePresence !== undefined &&
				!(await registration.validatePresence(validation.value, {
					actor: connection.actor,
					atom: address,
					session: connection.session,
					view: runtime.transceiver.READONLY_VIEW,
				}))
			) {
				return
			}
			if (connection.disposed) return
			const addressKey = mosaicAtomAddressKey(address)
			const records = presence.get(addressKey) ?? new Map()
			records.set(connection.session, {
				connection,
				presence: validation.value,
			})
			presence.set(addressKey, records)
			broadcastPresence(address, {
				actor: connection.actor,
				presence: validation.value,
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				atom: address,
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
			const runtime = runtimes.get(atomKey)
			if (runtime === undefined) continue
			await enqueue(runtime, async () => {
				await storage.clearSession(runtime.address, connection.session)
				removePresence(connection, runtime.address)
			})
		}
	}

	return {
		checkpoint: async (address): Promise<boolean> => {
			const parsedAddress = parseAtomAddress(address)
			const resolved =
				parsedAddress === null
					? undefined
					: await resolveRegistration(parsedAddress)
			if (resolved === undefined) return false
			const runtime = runtimeFor(resolved.registration, resolved.address)
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
		atomStatus: async (address): Promise<MosaicServerAtomStatus> => {
			const parsedAddress = parseAtomAddress(address)
			const resolved =
				parsedAddress === null
					? undefined
					: await resolveRegistration(parsedAddress)
			const runtime =
				resolved === undefined
					? undefined
					: runtimes.get(mosaicAtomAddressKey(resolved.address))
			return {
				initialized: runtime?.initialized ?? false,
				revision: runtime?.headRevision ?? 0,
			}
		},
	}
}

/** Preserve transceiver, schema and presence inference for one atom target. */
export function defineMosaicAtomRegistration<
	T extends AnyMosaicTransceiver,
	Presence extends Json.Serializable = Json.Serializable,
	Key extends Canonical = Canonical,
>(
	registration: MosaicAtomRegistration<T, Presence, Key>,
): MosaicAtomRegistration<T, Presence, Key> {
	return registration
}

/** Extract the transceiver's JSON-safe durable checkpoint type. */
export type MosaicServerSnapshot<T extends AnyMosaicTransceiver> =
	MosaicSnapshot<T>
