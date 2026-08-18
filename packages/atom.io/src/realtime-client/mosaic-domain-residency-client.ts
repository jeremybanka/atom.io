import type { MutableAtomToken, ReadableToken } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import {
	disposeFromStore,
	getFromStore,
	getJsonTokenFromStore,
} from "atom.io/internal"
import {
	type AnyMosaicTransceiver,
	applyMosaicDomainBatch,
	assertMosaicDomainBatchEnvelope,
	assertMosaicDomainResidencyAcceptedSlice,
	hydrateMosaicDomainBatches,
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
	type MosaicAcceptedDomainBatchEnvelope,
	type MosaicDomainBatchEnvelope,
	type MosaicDomainBatchMemberOperation,
	type MosaicDomainBatchProjection,
	type MosaicDomainBatchProposal,
	type MosaicDomainBatchRejection,
	type MosaicDomainIdentity,
	type MosaicDomainInstance,
	type MosaicDomainMemberAddress,
	mosaicDomainMemberAddressKey,
	mosaicDomainMemberModelIdentity,
	type MosaicDomainResidencyAcceptedSlice,
	type MosaicDomainResidencyCheckpoint,
	type MosaicDomainResidencyRequest,
	type MosaicDomainResidencySelection,
	type MosaicDomainResidencyTransport,
	preflightMosaicDomainBatch,
	type PreparedMosaicDomainBatch,
	reprojectMosaicDomainBatches,
	sliceMosaicDomainAcceptedBatch,
} from "atom.io/realtime"

export type MosaicDomainResidencyIdContext = {
	readonly actor: string
	readonly kind: `batch` | `operation`
	readonly sequence: number
	readonly session: string
}

type MaybePromise<Value> = Promise<Value> | Value

export type MosaicDomainResidencyClientState = {
	readonly connectivity: `connecting` | `live` | `offline` | `recovering`
	readonly estimatedResidentBytes: number
	readonly headRevision: number
	readonly pendingBatchIds: readonly string[]
	readonly problem: MosaicDomainBatchRejection | null
	readonly requestedMemberCount: number
	readonly residentMemberCount: number
}

export type MosaicDomainResidencyLease<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = Disposable & {
	readonly active: boolean
	readonly address: MosaicDomainMemberAddress<Identity>
	release(): void
	readonly token: ReadableToken<any, any, any>
}

export type MosaicDomainResidentMember<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly address: MosaicDomainMemberAddress<Identity>
	readonly token: ReadableToken<any, any, any>
}

export type MosaicDomainResidencySubscription<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = Disposable & {
	readonly active: boolean
	/** The normalized durable members represented by this request's latest cut. */
	readonly addresses: readonly MosaicDomainMemberAddress<Identity>[]
	readonly id: string
	release(): Promise<void>
}

export type MosaicDomainResidencyClientOperation<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly address: MosaicDomainMemberAddress<Identity>
	readonly id?: string
	readonly operation: Json.Serializable
}

export type MosaicDomainResidencyClientOptions<
	Identity extends MosaicDomainIdentity,
	Range extends Json.Serializable,
> = {
	readonly actor: string
	readonly cleanup?: (
		address: MosaicDomainMemberAddress<Identity>,
	) => MaybePromise<void>
	readonly domain: MosaicDomainInstance<Identity, any, any>
	readonly estimateBytes?: (snapshot: Json.Serializable) => number
	readonly idSource?: (context: MosaicDomainResidencyIdContext) => string
	readonly maxBufferedAcceptances?: number
	readonly maxResidentBytes?: number
	readonly maxResidentMembers?: number
	readonly session: string
	readonly transport: MosaicDomainResidencyTransport<Identity, Range>
}

export type MosaicDomainResidencyClient<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
	Range extends Json.Serializable = Json.Serializable,
> = Disposable & {
	acquire(
		address: MosaicDomainMemberAddress<Identity>,
	): Promise<MosaicDomainResidencyLease<Identity>>
	dispose(): Promise<void>
	evict(address: MosaicDomainMemberAddress<Identity>): Promise<boolean>
	forceEvict(address: MosaicDomainMemberAddress<Identity>): Promise<boolean>
	hydrate(
		selection: MosaicDomainResidencySelection<Identity, Range>,
	): Promise<void>
	reconnect(): Promise<void>
	/** Inspect an already-hydrated member without creating another ownership lease. */
	resident(
		address: MosaicDomainMemberAddress<Identity>,
	): Promise<MosaicDomainResidentMember<Identity> | null>
	readonly state: MosaicDomainResidencyClientState
	/** The single Store that owns resident members and derived resources. */
	readonly store: MosaicDomainInstance<Identity, any, any>[`store`]
	submit(
		operation:
			| MosaicDomainResidencyClientOperation<Identity>
			| readonly MosaicDomainResidencyClientOperation<Identity>[],
		group?: string | null,
	): Promise<void>
	subscribe(
		selection: MosaicDomainResidencySelection<Identity, Range>,
		listener?: (accepted: MosaicDomainResidencyAcceptedSlice<Identity>) => void,
	): Promise<MosaicDomainResidencySubscription<Identity>>
	subscribeState(
		listener: (state: MosaicDomainResidencyClientState) => void,
	): () => void
}

type Resident<Identity extends MosaicDomainIdentity> = {
	address: MosaicDomainMemberAddress<Identity>
	bytes: number
	hydrated: boolean
	owners: Set<string>
	token: ReadableToken<any, any, any>
}

type Request<
	Identity extends MosaicDomainIdentity,
	Range extends Json.Serializable,
> = {
	active: boolean
	addresses: readonly MosaicDomainMemberAddress<Identity>[]
	listener?: (accepted: MosaicDomainResidencyAcceptedSlice<Identity>) => void
	selection: MosaicDomainResidencySelection<Identity, Range>
}

type Pending<Identity extends MosaicDomainIdentity> = {
	confirmed: boolean
	prepared: PreparedMosaicDomainBatch<Identity> | null
	proposal: MosaicDomainBatchProposal<Identity>
}

const defaultIdSource = ({
	actor,
	kind,
	sequence,
	session,
}: MosaicDomainResidencyIdContext): string =>
	`${actor}:${session}:${kind}:${sequence}`

const defaultEstimateBytes = (snapshot: Json.Serializable): number =>
	new TextEncoder().encode(JSON.stringify(snapshot)).byteLength

const validLimit = (name: string, value: number): void => {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive safe integer.`)
	}
}

const validIdentifier = (value: unknown): value is string =>
	typeof value === `string` && value.length > 0 && value.length <= 512

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === `object` && value !== null && !Array.isArray(value)

const rejectionCodes = new Set<string>([
	`backpressure`,
	`batch-id-collision`,
	`capacity-exceeded`,
	`gap`,
	`incompatible-version`,
	`invalid-model-operation`,
	`invalid-payload`,
	`missing-dependency`,
	`operation-id-collision`,
	`unauthorized`,
])
const recoveryActions = new Set<string>([
	`discard-batch`,
	`resnapshot`,
	`retry`,
	`upgrade`,
])

function assertRejection(
	value: unknown,
): asserts value is MosaicDomainBatchRejection {
	if (
		typeof value !== `object` ||
		value === null ||
		!(`batchId` in value) ||
		(value.batchId !== null && typeof value.batchId !== `string`) ||
		!(`code` in value) ||
		typeof value.code !== `string` ||
		!rejectionCodes.has(value.code) ||
		!(`reason` in value) ||
		typeof value.reason !== `string` ||
		!(`recovery` in value) ||
		typeof value.recovery !== `string` ||
		!recoveryActions.has(value.recovery)
	) {
		throw new Error(`The Mosaic Domain residency rejection is invalid.`)
	}
}

/**
 * Maintain a bounded, explicitly requested projection of one Mosaic Domain.
 * Durable authority stays in MOS-11 storage; this controller owns only Store
 * residency, filtered settlement, and the session's optimistic outbox.
 */
export function createMosaicDomainResidencyClient<
	Identity extends MosaicDomainIdentity,
	Range extends Json.Serializable = Json.Serializable,
>(
	options: MosaicDomainResidencyClientOptions<Identity, Range>,
): MosaicDomainResidencyClient<Identity, Range> {
	const estimateBytes = options.estimateBytes ?? defaultEstimateBytes
	const idSource = options.idSource ?? defaultIdSource
	const maxBufferedAcceptances = options.maxBufferedAcceptances ?? 256
	const maxResidentBytes = options.maxResidentBytes ?? 16 * 1024 * 1024
	const maxResidentMembers = options.maxResidentMembers ?? 1024
	validLimit(`maxBufferedAcceptances`, maxBufferedAcceptances)
	validLimit(`maxResidentBytes`, maxResidentBytes)
	validLimit(`maxResidentMembers`, maxResidentMembers)

	const residents = new Map<string, Resident<Identity>>()
	const requests = new Map<string, Request<Identity, Range>>()
	const pending: Pending<Identity>[] = []
	const stateListeners = new Set<
		(state: MosaicDomainResidencyClientState) => void
	>()
	let connectivity: MosaicDomainResidencyClientState[`connectivity`] = `connecting`
	let disposed = false
	let headRevision = 0
	let problem: MosaicDomainBatchRejection | null = null
	let sequence = 0
	let batchSequence = 0
	let queue = Promise.resolve()
	let stopTransport: (() => void) | null = null
	const resourceKey = `atom.io/realtime/mosaic-domain-residency:${options.domain.identity.definition.key}@${options.domain.identity.definition.version}#${options.domain.identity.instance}:${options.actor}:${options.session}`
	if (options.domain.store.miscResources.has(resourceKey)) {
		throw new Error(
			`A Mosaic Domain residency client already owns this Store session.`,
		)
	}
	const measureBytes = (snapshot: Json.Serializable): number => {
		try {
			const estimated = estimateBytes(snapshot)
			if (Number.isSafeInteger(estimated) && estimated >= 0) return estimated
		} catch {
			// Instrumentation must not reclassify an already committed batch as
			// failed. Invalid custom estimates fall back to encoded JSON bytes.
		}
		return defaultEstimateBytes(snapshot)
	}

	const enqueue = <Value>(work: () => Promise<Value>): Promise<Value> => {
		const result = queue.then(work, work)
		queue = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}

	const stateSnapshot = (): MosaicDomainResidencyClientState => {
		let estimatedResidentBytes = 0
		let requestedMemberCount = 0
		for (const resident of residents.values()) {
			estimatedResidentBytes += resident.bytes
			if (resident.owners.size > 0) requestedMemberCount++
		}
		return Object.freeze({
			connectivity,
			estimatedResidentBytes,
			headRevision,
			pendingBatchIds: Object.freeze(pending.map(({ proposal }) => proposal.id)),
			problem,
			requestedMemberCount,
			residentMemberCount: residents.size,
		})
	}

	const notify = (): void => {
		const state = stateSnapshot()
		for (const listener of stateListeners) {
			try {
				listener(state)
			} catch (error) {
				options.domain.store.logger.error(
					`🐞`,
					`transaction`,
					`mosaic-domain-residency`,
					`A Mosaic Domain residency state listener threw.`,
					error,
				)
			}
		}
	}

	const background = (work: Promise<unknown>, boundary: string): void => {
		void work.catch((error) => {
			options.domain.store.logger.error(
				`🐞`,
				`transaction`,
				`mosaic-domain-residency`,
				boundary,
				error,
			)
		})
	}
	const safelyStop = (stop: (() => void) | null, boundary: string): void => {
		try {
			stop?.()
		} catch (error) {
			options.domain.store.logger.error(
				`🐞`,
				`transaction`,
				`mosaic-domain-residency`,
				boundary,
				error,
			)
		}
	}

	const wireRequests = (): MosaicDomainResidencyRequest<Identity, Range>[] =>
		[...requests]
			.filter(([, request]) => request.active)
			.map(([id, request]) => ({ id, selection: request.selection }))

	const residentAddressKeys = (): Set<string> =>
		new Set(
			[...residents]
				.filter(([, resident]) => resident.hydrated && resident.owners.size > 0)
				.map(([key]) => key),
		)

	const refreshResidentBytes = (
		keys: ReadonlySet<string> = new Set(residents.keys()),
	): void => {
		for (const key of keys) {
			const resident = residents.get(key)
			if (resident === undefined || !resident.hydrated) continue
			const token =
				resident.token.type === `mutable_atom`
					? getJsonTokenFromStore(
							options.domain.store,
							resident.token as MutableAtomToken<AnyMosaicTransceiver>,
						)
					: resident.token
			resident.bytes = measureBytes(
				structuredClone(
					getFromStore(options.domain.store, token),
				) as Json.Serializable,
			)
		}
	}

	const sliceEnvelope = (
		batch: MosaicDomainBatchEnvelope<Identity>,
		keys: ReadonlySet<string>,
		revision: number,
	): MosaicAcceptedDomainBatchEnvelope<Identity> | undefined =>
		sliceMosaicDomainAcceptedBatch<Identity>({ batch, revision }, keys)

	const pendingProjection = (
		keys: ReadonlySet<string>,
	): {
		indexes: number[]
		projection: MosaicDomainBatchProjection<Identity>[]
	} => {
		const indexes: number[] = []
		const projection: MosaicDomainBatchProjection<Identity>[] = []
		for (let index = 0; index < pending.length; index++) {
			if (pending[index].confirmed) continue
			const envelope: MosaicDomainBatchEnvelope<Identity> = {
				...pending[index].proposal,
				actor: options.actor,
			}
			const sliced = sliceEnvelope(envelope, keys, 1)
			if (sliced === undefined) continue
			indexes.push(index)
			projection.push({ batch: sliced.batch, revision: null })
		}
		return { indexes, projection }
	}

	const replaceProjection = async (
		confirmed: readonly MosaicAcceptedDomainBatchEnvelope<Identity>[],
		checkpoint?: MosaicDomainResidencyCheckpoint<Identity>,
		extraRemove: readonly PreparedMosaicDomainBatch<Identity>[] = [],
		projectionKeys?: ReadonlySet<string>,
	): Promise<void> => {
		const remove = [
			...extraRemove,
			...pending
				.map(({ prepared }) => prepared)
				.filter(
					(prepared): prepared is PreparedMosaicDomainBatch<Identity> =>
						prepared !== null,
				),
		]
		const keys = new Set(projectionKeys ?? residentAddressKeys())
		if (checkpoint !== undefined) {
			for (const member of checkpoint.members) {
				keys.add(mosaicDomainMemberAddressKey(member.address))
			}
		}
		const acceptedProjection: MosaicDomainBatchProjection<Identity>[] = []
		for (const accepted of confirmed) {
			const sliced = sliceEnvelope(accepted.batch, keys, accepted.revision)
			if (sliced !== undefined) {
				acceptedProjection.push({
					batch: sliced.batch,
					revision: accepted.revision,
				})
			}
		}
		const nextPending = pendingProjection(keys)
		const projection = [...acceptedProjection, ...nextPending.projection]
		const measurementKeys = new Set<string>()
		for (const prepared of remove) {
			for (const address of prepared.members) {
				measurementKeys.add(mosaicDomainMemberAddressKey(address))
			}
		}
		for (const item of projection) {
			for (const operation of item.batch.operations) {
				measurementKeys.add(mosaicDomainMemberAddressKey(operation.address))
			}
		}
		const prepared =
			checkpoint === undefined
				? await reprojectMosaicDomainBatches(options.domain, remove, projection)
				: await hydrateMosaicDomainBatches(
						options.domain,
						remove,
						checkpoint.members,
						projection,
					)
		for (const item of pending) item.prepared = null
		for (let index = 0; index < nextPending.indexes.length; index++) {
			pending[nextPending.indexes[index]].prepared =
				prepared[acceptedProjection.length + index]
		}
		if (checkpoint === undefined) refreshResidentBytes(measurementKeys)
	}

	const validateCheckpoint = async (
		checkpoint: MosaicDomainResidencyCheckpoint<Identity>,
		wire: readonly MosaicDomainResidencyRequest<Identity, Range>[],
	): Promise<
		ReadonlyMap<string, readonly MosaicDomainMemberAddress<Identity>[]>
	> => {
		if (
			!isRecord(checkpoint) ||
			!Array.isArray(checkpoint.members) ||
			!Array.isArray(checkpoint.resolutions) ||
			!Number.isSafeInteger(checkpoint.headRevision) ||
			checkpoint.headRevision < 0
		) {
			throw new Error(`A Mosaic Domain residency revision is invalid.`)
		}
		const expectedIds = new Set(wire.map(({ id }) => id))
		const resolutions = new Map<
			string,
			readonly MosaicDomainMemberAddress<Identity>[]
		>()
		const union = new Set<string>()
		for (const resolution of checkpoint.resolutions) {
			if (
				!isRecord(resolution) ||
				!validIdentifier(resolution[`requestId`]) ||
				!validIdentifier(resolution[`revisionToken`]) ||
				!Array.isArray(resolution[`addresses`]) ||
				!expectedIds.delete(resolution[`requestId`]) ||
				resolutions.has(resolution[`requestId`])
			) {
				throw new Error(`A Mosaic Domain residency resolution is invalid.`)
			}
			const normalized: MosaicDomainMemberAddress<Identity>[] = []
			for (const address of resolution[`addresses`]) {
				const parsed = await options.domain.parseAddress(address)
				if (parsed.member.role !== `durable`) {
					throw new Error(
						`A residency checkpoint contains a non-durable member.`,
					)
				}
				const key = mosaicDomainMemberAddressKey(parsed.address)
				union.add(key)
				normalized.push(parsed.address)
			}
			resolutions.set(resolution[`requestId`], normalized)
		}
		if (expectedIds.size > 0) {
			throw new Error(`A Mosaic Domain residency checkpoint is incomplete.`)
		}
		const futureResidents = new Set([...residents.keys(), ...union])
		if (futureResidents.size > maxResidentMembers) {
			throw new Error(
				`Mosaic Domain resident member count exceeds ${maxResidentMembers}.`,
			)
		}
		const snapshots = new Set<string>()
		let bytes = [...residents.values()].reduce(
			(total, resident) => total + resident.bytes,
			0,
		)
		const replaced = new Set<string>()
		for (const member of checkpoint.members) {
			if (!isRecord(member) || !(`address` in member) || !(`value` in member)) {
				throw new Error(
					`A Mosaic Domain residency checkpoint member is invalid.`,
				)
			}
			const parsed = await options.domain.parseAddress(member[`address`])
			const key = mosaicDomainMemberAddressKey(parsed.address)
			if (!union.has(key) || snapshots.has(key)) {
				throw new Error(
					`A Mosaic Domain residency checkpoint member is invalid.`,
				)
			}
			snapshots.add(key)
			const estimated = measureBytes(member[`value`] as Json.Serializable)
			const previous = residents.get(key)
			if (previous !== undefined && !replaced.has(key)) bytes -= previous.bytes
			replaced.add(key)
			bytes += estimated
		}
		if (snapshots.size !== union.size) {
			throw new Error(`A Mosaic Domain residency checkpoint is incomplete.`)
		}
		if (bytes > maxResidentBytes) {
			throw new Error(`Mosaic Domain resident bytes exceed ${maxResidentBytes}.`)
		}
		return resolutions
	}

	const installCheckpoint = async (
		checkpoint: MosaicDomainResidencyCheckpoint<Identity>,
		wire: readonly MosaicDomainResidencyRequest<Identity, Range>[],
		extraRemove: readonly PreparedMosaicDomainBatch<Identity>[] = [],
	): Promise<void> => {
		const resolutions = await validateCheckpoint(checkpoint, wire)
		if (checkpoint.headRevision < headRevision) {
			throw new Error(`A Mosaic Domain residency checkpoint moved backwards.`)
		}
		const checkpointKeys = new Set(
			checkpoint.members.map(({ address }) =>
				mosaicDomainMemberAddressKey(address),
			),
		)
		await replaceProjection([], checkpoint, extraRemove, checkpointKeys)
		for (const resident of residents.values()) resident.owners.clear()
		for (const [requestId, addresses] of resolutions) {
			const request = requests.get(requestId)
			if (request !== undefined) request.addresses = addresses
			for (const address of addresses) {
				const key = mosaicDomainMemberAddressKey(address)
				let resident = residents.get(key)
				if (resident === undefined) {
					const parsed = await options.domain.parseAddress(address)
					const acquired = await options.domain.acquire(parsed)
					resident = {
						address,
						bytes: 0,
						hydrated: true,
						owners: new Set(),
						token: acquired.token,
					}
					residents.set(key, resident)
				}
				resident.hydrated = true
				resident.owners.add(requestId)
			}
		}
		for (const snapshot of checkpoint.members) {
			const resident = residents.get(
				mosaicDomainMemberAddressKey(snapshot.address),
			)
			if (resident !== undefined) resident.bytes = measureBytes(snapshot.value)
		}
		for (const resident of residents.values()) {
			if (resident.owners.size === 0) resident.hydrated = false
		}
		refreshResidentBytes(checkpointKeys)
		headRevision = Math.max(headRevision, checkpoint.headRevision)
	}

	let resyncAgain = false
	const resyncRemovals: PreparedMosaicDomainBatch<Identity>[] = []
	let resyncing = false
	async function resync(
		extraRemove: readonly PreparedMosaicDomainBatch<Identity>[] = [],
	): Promise<void> {
		if (disposed)
			throw new Error(`This Mosaic Domain residency client is disposed.`)
		if (resyncing) {
			resyncRemovals.push(...extraRemove)
			resyncAgain = true
			return
		}
		resyncing = true
		connectivity = `recovering`
		notify()
		const wire = wireRequests()
		let nextStop: (() => void) | null = null
		const buffered: MosaicDomainResidencyAcceptedSlice<Identity>[] = []
		let buffering = true
		let bufferOverflowed = false
		try {
			if (wire.length > 0) {
				nextStop = await options.transport.subscribe(
					structuredClone(wire),
					(accepted) => {
						const received = structuredClone(accepted)
						if (buffering) {
							if (buffered.length < maxBufferedAcceptances) {
								buffered.push(received)
							} else {
								bufferOverflowed = true
							}
						} else {
							background(
								enqueue(() => handleAcceptedSlice(received)),
								`A Mosaic Domain residency event failed.`,
							)
						}
					},
				)
				const checkpoint = structuredClone(
					await options.transport.hydrate(structuredClone(wire)),
				)
				await installCheckpoint(checkpoint, wire, extraRemove)
			} else {
				await replaceProjection([], undefined, extraRemove)
				for (const resident of residents.values()) {
					resident.owners.clear()
					resident.hydrated = false
				}
			}
			const previousStop = stopTransport
			stopTransport = nextStop
			nextStop = null
			safelyStop(
				previousStop,
				`A Mosaic Domain residency unsubscribe failed during resync.`,
			)
			buffering = false
			if (bufferOverflowed) {
				resyncAgain = true
			} else {
				for (const accepted of buffered) {
					if (accepted.metadata.revision > headRevision) {
						await handleAcceptedSlice(accepted)
					}
				}
				connectivity = `live`
				notify()
			}
		} catch (error) {
			safelyStop(
				nextStop,
				`A failed Mosaic Domain residency subscription could not stop.`,
			)
			connectivity = `offline`
			notify()
			throw error
		} finally {
			resyncing = false
			if (resyncAgain && !disposed) {
				resyncAgain = false
				const deferred = resyncRemovals.splice(0, resyncRemovals.length)
				await resync(deferred)
			}
		}
	}

	async function handleAcceptedSlice(
		accepted: MosaicDomainResidencyAcceptedSlice<Identity>,
	): Promise<void> {
		try {
			assertMosaicDomainResidencyAcceptedSlice(accepted)
		} catch (error) {
			connectivity = `offline`
			notify()
			throw error
		}
		if (disposed || accepted.metadata.revision <= headRevision) return
		const ownIndex = pending.findIndex(
			({ proposal }) => proposal.id === accepted.metadata.batchId,
		)
		const own =
			ownIndex < 0 || accepted.batch === undefined
				? undefined
				: pending[ownIndex]
		const extraRemove =
			own?.prepared === null || own === undefined ? [] : [own.prepared]
		if (own !== undefined) {
			own.confirmed = true
			own.prepared = null
		}
		if (
			accepted.metadata.revision > headRevision + 1 ||
			accepted.invalidations.some(({ refresh }) => refresh)
		) {
			await resync(extraRemove)
		} else {
			await replaceProjection(
				accepted.batch === undefined ? [] : [accepted.batch],
				undefined,
				extraRemove,
			)
			headRevision = accepted.metadata.revision
			connectivity = `live`
			problem = null
			notify()
		}
		// Selection listeners observe the already-settled Store projection. An
		// application callback cannot interrupt protocol settlement for its peers.
		for (const invalidation of accepted.invalidations) {
			if (invalidation.matchedOperationCount === 0 && !invalidation.refresh) {
				continue
			}
			const request = requests.get(invalidation.requestId)
			if (!request?.active || request.listener === undefined) continue
			try {
				request.listener(accepted)
			} catch (error) {
				options.domain.store.logger.error(
					`🐞`,
					`transaction`,
					`mosaic-domain-residency`,
					`A Mosaic Domain residency selection listener threw.`,
					error,
				)
			}
		}
	}

	const addRequest = async (
		id: string,
		request: Request<Identity, Range>,
	): Promise<void> => {
		requests.set(id, request)
		try {
			await resync()
		} catch (error) {
			requests.delete(id)
			request.active = false
			throw error
		}
	}

	const releaseRequest = async (id: string): Promise<void> => {
		const request = requests.get(id)
		if (request === undefined || !request.active) return
		requests.delete(id)
		try {
			if (!disposed) await resync()
			request.active = false
		} catch (error) {
			requests.set(id, request)
			throw error
		}
	}

	const evictByKey = async (key: string, force: boolean): Promise<boolean> => {
		const resident = residents.get(key)
		if (resident === undefined) return false
		if (!force && resident.owners.size > 0) return false
		if (force) {
			const revoked = new Map<string, Request<Identity, Range>>()
			for (const owner of [...resident.owners]) {
				const request = requests.get(owner)
				if (request !== undefined) {
					revoked.set(owner, request)
					requests.delete(owner)
				}
			}
			try {
				if (!disposed) await resync()
				for (const request of revoked.values()) request.active = false
			} catch (error) {
				for (const [owner, request] of revoked) requests.set(owner, request)
				throw error
			}
		}
		await replaceProjection([])
		if (resident.token.family === undefined) {
			throw new Error(`A singleton Mosaic Domain member cannot be evicted.`)
		}
		if (options.domain.store.atoms.has(resident.token.key)) {
			disposeFromStore(options.domain.store, resident.token)
		}
		residents.delete(key)
		notify()
		await options.cleanup?.(resident.address)
		return true
	}

	const send = async (item: Pending<Identity>): Promise<void> => {
		let result: Awaited<ReturnType<typeof options.transport.propose>>
		try {
			result = structuredClone(
				await options.transport.propose(structuredClone(item.proposal)),
			)
		} catch {
			connectivity = `offline`
			notify()
			return
		}
		await enqueue(async () => {
			try {
				if (result.status !== `accepted` && result.status !== `rejected`) {
					throw new Error(
						`The Mosaic Domain residency proposal result is invalid.`,
					)
				}
				if (result.status === `accepted`) {
					assertMosaicDomainBatchEnvelope(result.accepted.batch)
					if (
						!Number.isSafeInteger(result.accepted.revision) ||
						result.accepted.revision < 1 ||
						result.accepted.batch.id !== item.proposal.id ||
						result.accepted.batch.actor !== options.actor ||
						result.accepted.batch.session !== options.session
					) {
						throw new Error(
							`The Mosaic Domain residency acceptance receipt is invalid.`,
						)
					}
				} else {
					assertRejection(result.rejection)
					if (
						result.rejection.batchId !== null &&
						result.rejection.batchId !== item.proposal.id
					) {
						throw new Error(`The Mosaic Domain residency rejection is invalid.`)
					}
				}
			} catch (error) {
				connectivity = `offline`
				notify()
				throw error
			}
			const index = pending.indexOf(item)
			if (index < 0) return
			const [removed] = pending.splice(index, 1)
			if (result.status === `rejected`) {
				problem = result.rejection
			} else {
				problem = null
			}
			// A response may race filtered subscription delivery. Rehydrating the
			// requested cut is deterministic for both acceptance and rejection.
			await resync(removed.prepared === null ? [] : [removed.prepared])
		})
	}

	const dispose = async (): Promise<void> => {
		if (disposed) return
		disposed = true
		options.domain.store.miscResources.delete(resourceKey)
		const failures: unknown[] = []
		try {
			stopTransport?.()
		} catch (error) {
			failures.push(error)
		}
		stopTransport = null
		try {
			options.transport.dispose?.()
		} catch (error) {
			failures.push(error)
		}
		for (const request of requests.values()) request.active = false
		requests.clear()
		const cleanup: Promise<void>[] = []
		for (const resident of [...residents.values()]) {
			if (
				resident.token.family !== undefined &&
				options.domain.store.atoms.has(resident.token.key)
			) {
				try {
					disposeFromStore(options.domain.store, resident.token)
				} catch (error) {
					failures.push(error)
				}
			}
			if (options.cleanup !== undefined) {
				cleanup.push(
					Promise.resolve().then(() => options.cleanup!(resident.address)),
				)
			}
		}
		residents.clear()
		pending.splice(0, pending.length)
		stateListeners.clear()
		for (const result of await Promise.allSettled(cleanup)) {
			if (result.status === `rejected`) failures.push(result.reason)
		}
		if (failures.length > 0) {
			throw new AggregateError(
				failures,
				`Mosaic Domain residency cleanup did not complete cleanly.`,
			)
		}
	}

	const client: MosaicDomainResidencyClient<Identity, Range> = {
		async acquire(address) {
			if (disposed)
				throw new Error(`This Mosaic Domain residency client is disposed.`)
			const parsed = await options.domain.parseAddress(structuredClone(address))
			if (parsed.member.role !== `durable`) {
				throw new Error(`Mosaic Domain residency accepts durable members only.`)
			}
			const normalized = parsed.address as MosaicDomainMemberAddress<Identity>
			const id = idSource({
				actor: options.actor,
				kind: `operation`,
				sequence: sequence++,
				session: options.session,
			})
			const request: Request<Identity, Range> = {
				active: true,
				addresses: [],
				selection: { addresses: [normalized], kind: `members` },
			}
			await enqueue(() => addRequest(id, request))
			const resident = residents.get(mosaicDomainMemberAddressKey(normalized))
			if (resident === undefined) {
				throw new Error(`Mosaic Domain acquisition returned no member.`)
			}
			const release = (): void => {
				if (!request.active) return
				background(
					enqueue(() => releaseRequest(id)),
					`A Mosaic Domain residency lease could not be released.`,
				)
			}
			return {
				get active() {
					return request.active
				},
				address: normalized,
				release,
				token: resident.token,
				[Symbol.dispose]: release,
			}
		},
		dispose,
		evict(address) {
			const received = structuredClone(address)
			return enqueue(async () => {
				const parsed = await options.domain.parseAddress(received)
				return evictByKey(mosaicDomainMemberAddressKey(parsed.address), false)
			})
		},
		forceEvict(address) {
			const received = structuredClone(address)
			return enqueue(async () => {
				const parsed = await options.domain.parseAddress(received)
				return evictByKey(mosaicDomainMemberAddressKey(parsed.address), true)
			})
		},
		hydrate(selection) {
			const received = structuredClone(selection)
			return enqueue(async () => {
				const id = idSource({
					actor: options.actor,
					kind: `operation`,
					sequence: sequence++,
					session: options.session,
				})
				const checkpoint = structuredClone(
					await options.transport.hydrate(
						structuredClone([{ id, selection: received }]),
					),
				)
				await validateCheckpoint(checkpoint, [{ id, selection: received }])
				if (checkpoint.headRevision < headRevision) {
					throw new Error(
						`A Mosaic Domain residency checkpoint moved backwards.`,
					)
				}
				await replaceProjection([], checkpoint)
				for (const snapshot of checkpoint.members) {
					const parsed = await options.domain.parseAddress(snapshot.address)
					const key = mosaicDomainMemberAddressKey(parsed.address)
					let resident = residents.get(key)
					if (resident === undefined) {
						const acquired = await options.domain.acquire(parsed)
						resident = {
							address: parsed.address,
							bytes: 0,
							hydrated: true,
							owners: new Set(),
							token: acquired.token,
						}
						residents.set(key, resident)
					}
					resident.bytes = measureBytes(snapshot.value)
					resident.hydrated = true
				}
				refreshResidentBytes(
					new Set(
						checkpoint.members.map(({ address }) =>
							mosaicDomainMemberAddressKey(address),
						),
					),
				)
				headRevision = Math.max(headRevision, checkpoint.headRevision)
				notify()
			})
		},
		reconnect() {
			return (async () => {
				await enqueue(() => resync())
				for (const item of [...pending]) await send(item)
			})()
		},
		async resident(address) {
			if (disposed)
				throw new Error(`This Mosaic Domain residency client is disposed.`)
			const parsed = await options.domain.parseAddress(structuredClone(address))
			const resident = residents.get(
				mosaicDomainMemberAddressKey(parsed.address),
			)
			if (
				resident === undefined ||
				!resident.hydrated ||
				resident.owners.size === 0
			) {
				return null
			}
			return { address: resident.address, token: resident.token }
		},
		get state() {
			return stateSnapshot()
		},
		store: options.domain.store,
		async submit(input, group = null) {
			const received = structuredClone(input)
			const item = await enqueue(async () => {
				if (disposed) {
					throw new Error(`This Mosaic Domain residency client is disposed.`)
				}
				const inputs = Array.isArray(received) ? received : [received]
				if (inputs.length === 0) {
					throw new Error(`A Mosaic Domain batch requires an operation.`)
				}
				const operations: MosaicDomainBatchMemberOperation<Identity>[] = []
				for (const operation of inputs) {
					const parsed = await options.domain.parseAddress(operation.address)
					const key = mosaicDomainMemberAddressKey(parsed.address)
					const resident = residents.get(key)
					if (
						resident === undefined ||
						!resident.hydrated ||
						resident.owners.size === 0
					) {
						throw new Error(
							`A Mosaic Domain operation requires an acquired, hydrated member.`,
						)
					}
					if (
						parsed.member.role !== `durable` ||
						parsed.member.model === undefined
					) {
						throw new Error(
							`A Mosaic Domain resident member has no batch model.`,
						)
					}
					operations.push({
						address: parsed.address,
						id:
							operation.id ??
							idSource({
								actor: options.actor,
								kind: `operation`,
								sequence: sequence++,
								session: options.session,
							}),
						model: mosaicDomainMemberModelIdentity(parsed.member.model),
						operation: structuredClone(operation.operation),
					})
				}
				const affected = new Map<string, MosaicDomainMemberAddress<Identity>>()
				for (const operation of operations) {
					affected.set(
						mosaicDomainMemberAddressKey(operation.address),
						operation.address,
					)
				}
				const nextBatchSequence = batchSequence + 1
				const proposal: MosaicDomainBatchProposal<Identity> = {
					affectedMembers: [...affected.values()],
					dependencies: pending.map((pendingItem) => pendingItem.proposal.id),
					domain: options.domain.identity,
					group,
					id: idSource({
						actor: options.actor,
						kind: `batch`,
						sequence: sequence++,
						session: options.session,
					}),
					operations,
					protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
					sequence: nextBatchSequence,
					session: options.session,
				}
				const prepared = await preflightMosaicDomainBatch(options.domain, {
					...proposal,
					actor: options.actor,
				})
				batchSequence = nextBatchSequence
				applyMosaicDomainBatch(prepared)
				const next = { confirmed: false, prepared, proposal }
				pending.push(next)
				refreshResidentBytes(
					new Set(
						operations.map(({ address }) =>
							mosaicDomainMemberAddressKey(address),
						),
					),
				)
				problem = null
				notify()
				return next
			})
			await send(item)
		},
		async subscribe(selection, listener) {
			if (disposed)
				throw new Error(`This Mosaic Domain residency client is disposed.`)
			const id = idSource({
				actor: options.actor,
				kind: `operation`,
				sequence: sequence++,
				session: options.session,
			})
			const request: Request<Identity, Range> = {
				active: true,
				addresses: [],
				...(listener === undefined ? {} : { listener }),
				selection: structuredClone(selection),
			}
			await enqueue(() => addRequest(id, request))
			return {
				get active() {
					return request.active
				},
				get addresses() {
					return structuredClone(request.addresses)
				},
				id,
				release: () => enqueue(() => releaseRequest(id)),
				[Symbol.dispose]() {
					background(
						enqueue(() => releaseRequest(id)),
						`A Mosaic Domain residency subscription could not be released.`,
					)
				},
			}
		},
		subscribeState(listener) {
			stateListeners.add(listener)
			try {
				listener(stateSnapshot())
			} catch (error) {
				options.domain.store.logger.error(
					`🐞`,
					`transaction`,
					`mosaic-domain-residency`,
					`A Mosaic Domain residency state listener threw.`,
					error,
				)
			}
			return () => stateListeners.delete(listener)
		},
		[Symbol.dispose]() {
			background(
				dispose(),
				`A Mosaic Domain residency client could not dispose.`,
			)
		},
	}
	options.domain.store.miscResources.set(resourceKey, client)
	return client
}
