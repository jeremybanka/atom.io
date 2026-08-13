import { createHash } from "node:crypto"

import type { Json } from "atom.io/foundations/json"
import {
	type AnyMosaicModel,
	MOSAIC_EVENTS,
	MOSAIC_PROTOCOL_VERSION,
	type MosaicAcceptedOperationEnvelope,
	type MosaicJoinEnvelope,
	type MosaicModelDecision,
	type MosaicOperation,
	type MosaicOperationEnvelope,
	type MosaicOperationProposal,
	type MosaicPresenceEnvelope,
	type MosaicPresenceProposal,
	type MosaicRejectionCode,
	type MosaicRejectionEnvelope,
	type MosaicResource,
	type MosaicSnapshot,
	type MosaicSnapshotEnvelope,
	type MosaicState,
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
	readonly resource: string
	readonly session: string
}

export type MosaicHistoryRequest = {
	readonly mode: `redo` | `undo`
	readonly targetOperationIds: readonly string[]
}

export type MosaicHistoryGroup = {
	readonly group: string
	readonly operationIds: readonly string[]
}

export type MosaicHistoryTimeline = {
	readonly redo: readonly MosaicHistoryGroup[]
	readonly undo: readonly MosaicHistoryGroup[]
}

export type MosaicPresenceContext<State> = {
	readonly actor: string
	readonly resource: string
	readonly session: string
	readonly state: State
}

export type MosaicHistoryPolicy<State, Operation> = {
	/** Return null for ordinary operations and a request for history operations. */
	readonly request: (operation: Operation) => MosaicHistoryRequest | null
	readonly timeline: (state: State, actor: string) => MosaicHistoryTimeline
}

export type MosaicServerResource<
	Model extends AnyMosaicModel,
	Presence extends Json.Serializable = Json.Serializable,
> = MosaicResource<Model> & {
	/** Checkpoint automatically after this many accepted operations. */
	readonly checkpointEvery?: number
	/** Optional selective-history cursor validation for this model. */
	readonly history?: MosaicHistoryPolicy<
		MosaicState<Model>,
		MosaicOperation<Model>
	>
	/** Validate and normalize untrusted model payloads before authorization. */
	readonly operationSchema: StandardSchemaV1<unknown, MosaicOperation<Model>>
	/** Presence is disabled unless a schema is supplied. */
	readonly presenceSchema?: StandardSchemaV1<unknown, Presence>
	/** Perform model-aware checks such as validating relative anchors. */
	readonly validatePresence?: (
		presence: Presence,
		context: MosaicPresenceContext<MosaicState<Model>>,
	) => MaybePromise<boolean>
}

export type MosaicServerConnection = {
	readonly actor: string
	readonly session: string
	readonly socket: Socket
}

/** Internal erasure that preserves heterogeneous resource/presence inference. */
type ErasedResource = MosaicResource<AnyMosaicModel> & {
	readonly checkpointEvery?: number
	readonly history?: MosaicHistoryPolicy<any, any>
	readonly operationSchema: StandardSchemaV1<unknown, any>
	readonly presenceSchema?: StandardSchemaV1<unknown, any>
	readonly validatePresence?: (
		presence: any,
		context: MosaicPresenceContext<any>,
	) => MaybePromise<boolean>
}

export type MosaicServerOptions = {
	readonly authorize?: (
		context: MosaicAuthorizationContext,
	) => MaybePromise<boolean>
	readonly resources: readonly ErasedResource[]
	readonly storage?: MosaicStorageAdapter
}

export type MosaicServerResourceStatus = {
	readonly initialized: boolean
	readonly revision: number
}

export type MosaicServer = {
	checkpoint(resource: string): Promise<boolean>
	connect(connection: MosaicServerConnection): () => Promise<void>
	dispose(): Promise<void>
	resourceStatus(resource: string): MosaicServerResourceStatus
}

type ResourceRuntime = {
	checkpointTail: Promise<void>
	disposeWatch: (() => void) | undefined
	headRevision: number
	initialized: boolean
	receiptIds: Set<string>
	resource: ErasedResource
	retentionEpoch: number
	state: unknown
	tail: Promise<void>
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
	resource: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === `object` && value !== null && !Array.isArray(value)

const isIdentifier = (value: unknown, maximum = 512): value is string =>
	typeof value === `string` && value.length > 0 && value.length <= maximum

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
		resource: operation.resource,
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
	const resources = new Map<string, ErasedResource>()
	for (const resource of options.resources) {
		if (resources.has(resource.key)) {
			throw new Error(`Duplicate Mosaic resource key "${resource.key}"`)
		}
		if (
			resource.checkpointEvery !== undefined &&
			(!Number.isSafeInteger(resource.checkpointEvery) ||
				resource.checkpointEvery < 1)
		) {
			throw new Error(`checkpointEvery must be a positive safe integer`)
		}
		resources.set(resource.key, resource)
	}

	const runtimes = new Map<string, ResourceRuntime>()
	const connections = new Set<ConnectionState>()
	const presence = new Map<string, Map<string, PresenceRecord>>()
	let disposed = false

	const runtimeFor = (resource: ErasedResource): ResourceRuntime => {
		let runtime = runtimes.get(resource.key)
		if (runtime === undefined) {
			runtime = {
				checkpointTail: Promise.resolve(),
				disposeWatch: undefined,
				headRevision: 0,
				initialized: false,
				receiptIds: new Set(),
				resource,
				retentionEpoch: 0,
				state: resource.model.create(),
				tail: Promise.resolve(),
			}
			runtimes.set(resource.key, runtime)
		}
		return runtime
	}

	const enqueue = <Value>(
		runtime: ResourceRuntime,
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
		resource: ErasedResource,
		recovery: MosaicStorageRecovery,
	): void => {
		if (recovery.checkpoint !== null) {
			if (
				recovery.checkpoint.protocolVersion !== MOSAIC_PROTOCOL_VERSION ||
				recovery.checkpoint.resource !== resource.key ||
				!matchesModel(recovery.checkpoint.model, resource.model)
			) {
				throw new Error(
					`Mosaic checkpoint for "${resource.key}" uses an incompatible protocol or model`,
				)
			}
		}
		let expected = (recovery.checkpoint?.revision ?? 0) + 1
		for (const accepted of recovery.tail) {
			if (
				accepted.revision !== expected ||
				accepted.operation.resource !== resource.key ||
				accepted.operation.protocolVersion !== MOSAIC_PROTOCOL_VERSION ||
				!matchesModel(accepted.operation.model, resource.model)
			) {
				throw new Error(
					`Mosaic recovery for "${resource.key}" is incompatible or non-contiguous at revision ${expected}`,
				)
			}
			expected++
		}
		if (expected - 1 !== recovery.headRevision) {
			throw new Error(
				`Mosaic recovery for "${resource.key}" ended at ${expected - 1}, expected ${recovery.headRevision}`,
			)
		}
	}

	const applyAccepted = (
		runtime: ResourceRuntime,
		accepted: MosaicAcceptedOperationEnvelope,
	): void => {
		if (accepted.revision !== runtime.headRevision + 1) {
			throw new Error(
				`Cannot apply Mosaic revision ${accepted.revision} after ${runtime.headRevision}`,
			)
		}
		const operation = accepted.operation
		const reductionContext = { ...operation, revision: accepted.revision }
		runtime.state = runtime.resource.model.apply(
			runtime.state,
			operation.operation,
			reductionContext,
		)
		runtime.headRevision = accepted.revision
		runtime.receiptIds.add(operation.id)
	}

	const drain = async (
		runtime: ResourceRuntime,
		broadcastChanges = false,
	): Promise<void> => {
		const before = runtime.headRevision
		const recovery = await storage.recover(runtime.resource.key)
		assertRecovery(runtime.resource, recovery)
		const checkpointRevision = recovery.checkpoint?.revision ?? 0
		if (!runtime.initialized || checkpointRevision > runtime.headRevision) {
			runtime.state = recovery.checkpoint
				? runtime.resource.model.hydrate(recovery.checkpoint.snapshot)
				: runtime.resource.model.create()
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
				if (connection.joined.has(runtime.resource.key)) {
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
				broadcastAccepted(runtime.resource.key, accepted)
			}
		}
	}

	const initialize = async (runtime: ResourceRuntime): Promise<void> => {
		if (runtime.initialized) return
		await drain(runtime)
		if (runtime.disposeWatch === undefined && storage.watchHead !== undefined) {
			runtime.disposeWatch = await storage.watchHead(
				runtime.resource.key,
				(hint) => {
					if (hint.revision <= runtime.headRevision || disposed) return
					void enqueue(runtime, async () => {
						await drain(runtime, true)
					})
				},
			)
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
			resource: rejection.resource,
			session: connection.session,
		}
		emit(connection, MOSAIC_EVENTS.rejection, envelope)
	}

	function broadcastAccepted(
		resource: string,
		accepted: MosaicAcceptedOperationEnvelope,
	): void {
		for (const connection of connections) {
			if (connection.joined.has(resource)) {
				emit(connection, MOSAIC_EVENTS.operation, accepted)
			}
		}
	}

	const broadcastPresence = (
		resource: string,
		envelope: MosaicPresenceEnvelope<Json.Serializable | null>,
	): void => {
		for (const connection of connections) {
			if (connection.joined.has(resource)) {
				emit(connection, MOSAIC_EVENTS.presence, envelope)
			}
		}
	}

	const isAuthorized = async (
		context: MosaicAuthorizationContext,
	): Promise<boolean> => (await options.authorize?.(context)) ?? true

	const checkpointRuntime = async (
		runtime: ResourceRuntime,
	): Promise<boolean> => {
		await initialize(runtime)
		await drain(runtime)
		const checkpoint = {
			model: {
				key: runtime.resource.model.key,
				version: runtime.resource.model.version,
			},
			protocolVersion: MOSAIC_PROTOCOL_VERSION,
			resource: runtime.resource.key,
			revision: runtime.headRevision,
			snapshot: runtime.resource.model.snapshot(runtime.state),
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

	const scheduleCheckpoint = (runtime: ResourceRuntime): void => {
		const every = runtime.resource.checkpointEvery
		if (every === undefined || runtime.headRevision % every !== 0) return
		runtime.checkpointTail = runtime.checkpointTail.then(async () => {
			await enqueue(runtime, () => checkpointRuntime(runtime))
		})
	}

	const snapshotFor = (
		runtime: ResourceRuntime,
		pendingOperationIds: readonly string[],
		session: string,
	): MosaicSnapshotEnvelope => ({
		acceptedPendingOperationIds: pendingOperationIds.filter((id) =>
			runtime.receiptIds.has(id),
		),
		model: {
			key: runtime.resource.model.key,
			version: runtime.resource.model.version,
		},
		protocolVersion: MOSAIC_PROTOCOL_VERSION,
		resource: runtime.resource.key,
		revision: runtime.headRevision,
		session,
		snapshot: runtime.resource.model.snapshot(runtime.state),
	})

	const parseJoin = (payload: unknown): MosaicJoinEnvelope | null => {
		if (!isRecord(payload)) return null
		const knownRevision = payload[`knownRevision`]
		const pendingOperationIds = payload[`pendingOperationIds`]
		if (
			payload[`protocolVersion`] !== MOSAIC_PROTOCOL_VERSION ||
			!isIdentifier(payload[`resource`]) ||
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
			!isIdentifier(payload[`resource`]) ||
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
		const resourceKey =
			isRecord(payload) && isIdentifier(payload[`resource`])
				? payload[`resource`]
				: `unknown`
		if (
			isRecord(payload) &&
			payload[`protocolVersion`] !== MOSAIC_PROTOCOL_VERSION
		) {
			reject(connection, {
				code: `incompatible-version`,
				reason: `The Mosaic protocol version is incompatible.`,
				recovery: `upgrade`,
				resource: resourceKey,
			})
			return
		}
		if (request === null) {
			reject(connection, {
				code: `invalid-payload`,
				reason: `Malformed Mosaic join request.`,
				recovery: `discard-operation`,
				resource: resourceKey,
			})
			return
		}
		const resource = resources.get(request.resource)
		if (resource === undefined) {
			reject(connection, {
				code: `resource-unavailable`,
				reason: `That Mosaic resource is unavailable.`,
				recovery: `none`,
				resource: request.resource,
			})
			return
		}
		if (!matchesModel(request.model, resource.model)) {
			reject(connection, {
				code: `incompatible-version`,
				reason: `The Mosaic model version is incompatible.`,
				recovery: `upgrade`,
				resource: request.resource,
			})
			return
		}
		if (request.session !== connection.session) {
			reject(connection, {
				code: `unauthorized`,
				reason: `The authenticated session does not own this request.`,
				recovery: `none`,
				resource: request.resource,
			})
			return
		}
		// Read authorization deliberately precedes all persistence access.
		if (
			!(await isAuthorized({
				action: `read`,
				actor: connection.actor,
				resource: request.resource,
				session: connection.session,
			}))
		) {
			reject(connection, {
				code: `unauthorized`,
				reason: `Not authorized to read this Mosaic resource.`,
				recovery: `none`,
				resource: request.resource,
			})
			return
		}
		const runtime = runtimeFor(resource)
		await enqueue(runtime, async () => {
			await initialize(runtime)
			await drain(runtime)
			connection.joined.add(request.resource)
			await storage.setSessionWatermark(
				request.resource,
				connection.session,
				request.knownRevision ?? 0,
			)
			emit(
				connection,
				MOSAIC_EVENTS.snapshot,
				snapshotFor(runtime, request.pendingOperationIds, connection.session),
			)
		})
		for (const record of presence.get(request.resource)?.values() ?? []) {
			const envelope: MosaicPresenceEnvelope = {
				actor: record.connection.actor,
				presence: record.presence,
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				resource: request.resource,
				session: record.connection.session,
			}
			emit(connection, MOSAIC_EVENTS.presence, envelope)
		}
	}

	const validateHistory = (
		runtime: ResourceRuntime,
		operation: Json.Serializable,
		actor: string,
	): string | null => {
		const policy = runtime.resource.history
		if (policy === undefined) return null
		const request = policy.request(operation)
		if (request === null) return null
		const actorTimeline = policy.timeline(runtime.state, actor)
		const expected = actorTimeline[request.mode].at(-1)
		return expected !== undefined &&
			sameStrings(expected.operationIds, request.targetOperationIds)
			? null
			: `The selective history cursor moved; resnapshot and try again.`
	}

	const propose = async (
		connection: ConnectionState,
		payload: unknown,
	): Promise<void> => {
		const proposal = parseProposal(payload)
		const resourceKey =
			isRecord(payload) && isIdentifier(payload[`resource`])
				? payload[`resource`]
				: `unknown`
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
				resource: resourceKey,
			})
			return
		}
		if (proposal === null) {
			reject(connection, {
				code: `invalid-payload`,
				operationId,
				reason: `Malformed Mosaic operation proposal.`,
				recovery: `discard-operation`,
				resource: resourceKey,
			})
			return
		}
		const resource = resources.get(proposal.resource)
		if (
			resource === undefined ||
			!connection.joined.has(proposal.resource) ||
			!matchesModel(proposal.model, resource.model)
		) {
			reject(connection, {
				code:
					resource === undefined
						? `resource-unavailable`
						: `incompatible-version`,
				operationId: proposal.id,
				reason: `Join a compatible Mosaic resource before proposing operations.`,
				recovery: `resnapshot`,
				resource: proposal.resource,
			})
			return
		}
		if (proposal.session !== connection.session) {
			reject(connection, {
				code: `unauthorized`,
				operationId: proposal.id,
				reason: `The authenticated session does not own this proposal.`,
				recovery: `discard-operation`,
				resource: proposal.resource,
			})
			return
		}

		const schemaResult = await resource.operationSchema[`~standard`].validate(
			proposal.operation,
		)
		if (schemaResult.issues !== undefined) {
			reject(connection, {
				code: `invalid-model-operation`,
				operationId: proposal.id,
				reason: schemaReason(schemaResult.issues),
				recovery: `discard-operation`,
				resource: proposal.resource,
			})
			return
		}
		// The schema is the trust boundary before operation-level authorization.
		if (
			!(await isAuthorized({
				action: `propose`,
				actor: connection.actor,
				operation: schemaResult.value,
				resource: proposal.resource,
				session: connection.session,
			}))
		) {
			reject(connection, {
				code: `unauthorized`,
				operationId: proposal.id,
				reason: `Not authorized to edit this Mosaic resource.`,
				recovery: `discard-operation`,
				resource: proposal.resource,
			})
			return
		}

		const runtime = runtimeFor(resource)
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
					authenticated.resource,
					authenticated.id,
				)
				if (existing !== null) {
					if (existing.fingerprint === proposalFingerprint) {
						emit(connection, MOSAIC_EVENTS.operation, existing.accepted)
						await storage.setSessionWatermark(
							authenticated.resource,
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
						resource: authenticated.resource,
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
						resource: authenticated.resource,
					})
					return
				}
				const validationContext = {
					...authenticated,
					revision: runtime.headRevision + 1,
				}
				const decision: MosaicModelDecision<Json.Serializable> =
					runtime.resource.model.validate(
						runtime.state,
						authenticated.operation,
						validationContext,
					)
				if (decision.status === `defer`) {
					reject(connection, {
						code: `missing-dependency`,
						operationId: authenticated.id,
						reason: `The model deferred this operation pending: ${decision.dependencies.join(`, `)}.`,
						recovery: `retry`,
						resource: authenticated.resource,
					})
					return
				}
				if (decision.status === `reject`) {
					reject(connection, {
						code: `invalid-model-operation`,
						operationId: authenticated.id,
						reason: decision.reason,
						recovery: `discard-operation`,
						resource: authenticated.resource,
					})
					return
				}
				const normalized: MosaicOperationEnvelope = {
					...authenticated,
					operation: decision.operation,
				}
				const historyFailure = validateHistory(
					runtime,
					normalized.operation,
					normalized.actor,
				)
				if (historyFailure !== null) {
					reject(connection, {
						code: `stale-history`,
						operationId: normalized.id,
						reason: historyFailure,
						recovery: `resnapshot`,
						resource: normalized.resource,
					})
					return
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
						resource: normalized.resource,
					})
					return
				}
				if (result.status === `duplicate`) {
					emit(connection, MOSAIC_EVENTS.operation, result.accepted)
					await storage.setSessionWatermark(
						normalized.resource,
						connection.session,
						result.accepted.revision,
					)
					return
				}
				applyAccepted(runtime, result.accepted)
				await storage.setSessionWatermark(
					normalized.resource,
					connection.session,
					result.accepted.revision,
				)
				broadcastAccepted(normalized.resource, result.accepted)
				scheduleCheckpoint(runtime)
				return
			}
			reject(connection, {
				code: `resource-unavailable`,
				operationId: proposal.id,
				reason: `The Mosaic stream remained contended; retry the proposal.`,
				recovery: `retry`,
				resource: proposal.resource,
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
			!isIdentifier(payload[`resource`]) ||
			!isIdentifier(payload[`session`])
		) {
			return
		}
		const proposal = payload as MosaicPresenceProposal
		const resource = resources.get(proposal.resource)
		if (
			resource?.presenceSchema === undefined ||
			proposal.session !== connection.session ||
			!connection.joined.has(proposal.resource)
		) {
			return
		}
		if (proposal.presence === null) {
			if (
				!(await isAuthorized({
					action: `presence`,
					actor: connection.actor,
					operation: null,
					resource: proposal.resource,
					session: connection.session,
				}))
			) {
				return
			}
			const records = presence.get(proposal.resource)
			if (records?.delete(connection.session)) {
				broadcastPresence(proposal.resource, {
					actor: connection.actor,
					presence: null,
					protocolVersion: MOSAIC_PROTOCOL_VERSION,
					resource: proposal.resource,
					session: connection.session,
				})
			}
			if (records?.size === 0) presence.delete(proposal.resource)
			return
		}
		const validation = await resource.presenceSchema[`~standard`].validate(
			proposal.presence,
		)
		if (validation.issues !== undefined) return
		if (
			!(await isAuthorized({
				action: `presence`,
				actor: connection.actor,
				operation: validation.value,
				resource: proposal.resource,
				session: connection.session,
			}))
		) {
			return
		}
		const records = presence.get(proposal.resource) ?? new Map()
		const runtime = runtimeFor(resource)
		await enqueue(runtime, async () => {
			await initialize(runtime)
			await drain(runtime, true)
			if (
				resource.validatePresence !== undefined &&
				!(await resource.validatePresence(validation.value, {
					actor: connection.actor,
					resource: proposal.resource,
					session: connection.session,
					state: runtime.state,
				}))
			) {
				return
			}
			records.set(connection.session, {
				connection,
				presence: validation.value,
			})
			presence.set(proposal.resource, records)
			broadcastPresence(proposal.resource, {
				actor: connection.actor,
				presence: validation.value,
				protocolVersion: MOSAIC_PROTOCOL_VERSION,
				resource: proposal.resource,
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
		for (const resource of connection.joined) {
			await storage.clearSession(resource, connection.session)
			const records = presence.get(resource)
			if (records?.delete(connection.session)) {
				broadcastPresence(resource, {
					actor: connection.actor,
					presence: null,
					protocolVersion: MOSAIC_PROTOCOL_VERSION,
					resource,
					session: connection.session,
				})
			}
			if (records?.size === 0) presence.delete(resource)
		}
	}

	return {
		checkpoint: async (resourceKey): Promise<boolean> => {
			const resource = resources.get(resourceKey)
			if (resource === undefined) return false
			const runtime = runtimeFor(resource)
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
							code: `resource-unavailable`,
							reason: `The Mosaic server could not process that request.`,
							recovery: `retry`,
							resource:
								isRecord(args[0]) && isIdentifier(args[0][`resource`])
									? args[0][`resource`]
									: `unknown`,
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
		resourceStatus: (resourceKey): MosaicServerResourceStatus => {
			const runtime = runtimes.get(resourceKey)
			return {
				initialized: runtime?.initialized ?? false,
				revision: runtime?.headRevision ?? 0,
			}
		},
	}
}

/** Preserve model, schema, history and presence inference for one resource. */
export function defineMosaicServerResource<
	Model extends AnyMosaicModel,
	Presence extends Json.Serializable = Json.Serializable,
>(
	resource: MosaicServerResource<Model, Presence>,
): MosaicServerResource<Model, Presence> {
	return resource
}

/** Extract the model's JSON-safe durable snapshot type. */
export type MosaicServerSnapshot<Model extends AnyMosaicModel> =
	MosaicSnapshot<Model>
