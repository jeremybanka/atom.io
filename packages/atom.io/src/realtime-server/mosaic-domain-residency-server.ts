import type { MutableAtomToken } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import { getFromStore, getJsonTokenFromStore } from "atom.io/internal"
import {
	type AnyMosaicTransceiver,
	type MosaicAcceptedDomainBatchEnvelope,
	type MosaicDomainIdentity,
	type MosaicDomainInstance,
	type MosaicDomainMemberAddress,
	MAX_MOSAIC_DOMAIN_RESIDENCY_INVALIDATIONS,
	mosaicDomainMemberAddressKey,
	type MosaicDomainResidencyAcceptedSlice,
	type MosaicDomainResidencyCheckpoint,
	type MosaicDomainResidencyRequest,
	type MosaicDomainResidencySelection,
	type MosaicDomainResidencyTransport,
	sliceMosaicDomainAcceptedBatch,
	type StandardSchemaV1,
} from "atom.io/realtime"

import type {
	MosaicDomainBatchConnection,
	MosaicDomainBatchServer,
} from "./mosaic-domain-batch-server.ts"

type MaybePromise<Value> = Promise<Value> | Value

export type MosaicDomainResidencyAuthorizationContext<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
	Range extends Json.Serializable = Json.Serializable,
> =
	| {
			readonly action: `read-member`
			readonly actor: string
			readonly address: MosaicDomainMemberAddress<Identity>
			readonly session: string
	  }
	| {
			readonly action: `resolve-range`
			readonly actor: string
			readonly selection: MosaicDomainResidencySelection<Identity, Range>
			readonly session: string
	  }

export type MosaicDomainRangeResolver<
	Identity extends MosaicDomainIdentity,
	Range extends Json.Serializable,
> = (context: {
	readonly domain: MosaicDomainInstance<Identity, any, any>
	readonly limit: number
	readonly member: string
	readonly range: Range
}) => MaybePromise<readonly MosaicDomainMemberAddress<Identity>[]>

export type MosaicDomainResidencyServerOptions<
	Identity extends MosaicDomainIdentity,
	RangeInput,
	Range extends Json.Serializable,
> = {
	readonly authorize?: (
		context: MosaicDomainResidencyAuthorizationContext<Identity, Range>,
	) => MaybePromise<boolean>
	readonly batches: MosaicDomainBatchServer
	readonly domain: MosaicDomainInstance<Identity, any, any>
	readonly maxRangeBytes?: number
	readonly maxRangeDepth?: number
	readonly maxRequests?: number
	readonly maxResidentMembers?: number
	readonly range?: {
		readonly resolve: MosaicDomainRangeResolver<Identity, Range>
		readonly schema: StandardSchemaV1<RangeInput, Range>
	}
}

export type MosaicDomainResidencyServer<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
	Range extends Json.Serializable = Json.Serializable,
> = Disposable & {
	connect(identity: {
		readonly actor: string
		readonly session: string
	}): MosaicDomainResidencyTransport<Identity, Range>
}

type ResolvedRequest<Identity extends MosaicDomainIdentity> = {
	readonly addresses: readonly MosaicDomainMemberAddress<Identity>[]
	readonly id: string
	readonly kind: `members` | `range`
}

const revisionToken = (
	identity: MosaicDomainIdentity,
	revision: number,
): string =>
	`${identity.definition.key}@${identity.definition.version}#${identity.instance}:${revision}`

const validId = (value: unknown): value is string =>
	typeof value === `string` && value.length > 0 && value.length <= 512

function assertBoundedRange(
	value: unknown,
	maxBytes: number,
	maxDepth: number,
): asserts value is Json.Serializable {
	type Visit =
		| { readonly kind: `enter`; readonly depth: number; readonly value: unknown }
		| { readonly kind: `leave`; readonly value: object }
	const encoder = new TextEncoder()
	const ancestors = new WeakSet<object>()
	const visits: Visit[] = [{ depth: 0, kind: `enter`, value }]
	let bytes = 0
	const add = (valueBytes: number): void => {
		bytes += valueBytes
		if (bytes > maxBytes) {
			throw new Error(`Mosaic Domain range bytes exceed ${maxBytes}.`)
		}
	}
	while (visits.length > 0) {
		const visit = visits.pop()!
		if (visit.kind === `leave`) {
			ancestors.delete(visit.value)
			continue
		}
		if (visit.depth > maxDepth) {
			throw new Error(`Mosaic Domain range depth exceeds ${maxDepth}.`)
		}
		const item = visit.value
		if (
			item === null ||
			typeof item === `boolean` ||
			typeof item === `string` ||
			(typeof item === `number` && Number.isFinite(item))
		) {
			add(encoder.encode(JSON.stringify(item)).byteLength)
			continue
		}
		if (typeof item !== `object` || ancestors.has(item)) {
			throw new Error(`A Mosaic Domain range must be JSON-serializable.`)
		}
		const prototype = Object.getPrototypeOf(item) as {
			readonly constructor?: { readonly name?: string }
		} | null
		if (
			!Array.isArray(item) &&
			prototype !== null &&
			prototype.constructor?.name !== `Object`
		) {
			throw new Error(`A Mosaic Domain range must be JSON-serializable.`)
		}
		ancestors.add(item)
		visits.push({ kind: `leave`, value: item })
		if (Array.isArray(item)) {
			add(2 + Math.max(0, item.length - 1))
			for (let index = item.length - 1; index >= 0; index--) {
				visits.push({
					depth: visit.depth + 1,
					kind: `enter`,
					value: item[index],
				})
			}
			continue
		}
		const entries = Object.entries(item)
		add(2 + Math.max(0, entries.length - 1))
		for (let index = entries.length - 1; index >= 0; index--) {
			const [key, child] = entries[index]
			add(encoder.encode(JSON.stringify(key)).byteLength + 1)
			visits.push({
				depth: visit.depth + 1,
				kind: `enter`,
				value: child,
			})
		}
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

/**
 * Add authorized, bounded residency views to a MOS-11 Domain batch server.
 * The batch server remains the only mutation and durability authority.
 */
export function createMosaicDomainResidencyServer<
	Identity extends MosaicDomainIdentity,
	RangeInput = Json.Serializable,
	Range extends Json.Serializable = Json.Serializable,
>(
	options: MosaicDomainResidencyServerOptions<Identity, RangeInput, Range>,
): MosaicDomainResidencyServer<Identity, Range> {
	const maxRequests = options.maxRequests ?? 64
	const maxResidentMembers = options.maxResidentMembers ?? 1024
	const maxRangeBytes = options.maxRangeBytes ?? 16 * 1024
	const maxRangeDepth = options.maxRangeDepth ?? 32
	for (const [name, value] of [
		[`maxRequests`, maxRequests],
		[`maxResidentMembers`, maxResidentMembers],
		[`maxRangeBytes`, maxRangeBytes],
		[`maxRangeDepth`, maxRangeDepth],
	] as const) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new Error(`${name} must be a positive safe integer.`)
		}
	}
	if (maxRequests > MAX_MOSAIC_DOMAIN_RESIDENCY_INVALIDATIONS) {
		throw new Error(
			`maxRequests cannot exceed ${MAX_MOSAIC_DOMAIN_RESIDENCY_INVALIDATIONS}.`,
		)
	}
	let disposed = false
	const connectionDisposers = new Set<() => void>()

	const connect = ({
		actor,
		session,
	}: {
		readonly actor: string
		readonly session: string
	}): MosaicDomainResidencyTransport<Identity, Range> => {
		if (disposed)
			throw new Error(`This Mosaic Domain residency server is disposed.`)
		const batchConnection = options.batches.connect({ actor, session })
		let connectionDisposed = false
		const subscriptions = new Set<() => void>()

		const authorize = async (
			context: MosaicDomainResidencyAuthorizationContext<Identity, Range>,
		): Promise<void> => {
			let authorized = true
			try {
				authorized =
					options.authorize === undefined || (await options.authorize(context))
			} catch {
				authorized = false
			}
			if (!authorized)
				throw new Error(`Mosaic Domain residency is unauthorized.`)
		}

		const normalizeRange = async (
			selection: Extract<
				MosaicDomainResidencySelection<Identity, Range>,
				{ kind: `range` }
			>,
		): Promise<typeof selection> => {
			if (options.range === undefined) {
				throw new Error(`This Mosaic Domain does not provide range resolution.`)
			}
			if (!Number.isSafeInteger(selection.limit) || selection.limit < 1) {
				throw new Error(`A Mosaic Domain range limit must be positive.`)
			}
			if (selection.limit > maxResidentMembers) {
				throw new Error(
					`A Mosaic Domain range limit exceeds ${maxResidentMembers}.`,
				)
			}
			assertBoundedRange(selection.range, maxRangeBytes, maxRangeDepth)
			const member = options.domain.members[selection.member]
			if (
				member === undefined ||
				member.role !== `durable` ||
				!member.token.type.endsWith(`_family`)
			) {
				throw new Error(
					`A Mosaic Domain range requires a durable family member.`,
				)
			}
			const result = await options.range.schema[`~standard`].validate(
				selection.range,
			)
			if (result.issues) {
				throw new Error(
					`Mosaic Domain range failed validation: ${result.issues
						.map(({ message }) => message)
						.join(`; `)}`,
				)
			}
			assertBoundedRange(result.value, maxRangeBytes, maxRangeDepth)
			const repeated = await options.range.schema[`~standard`].validate(
				structuredClone(result.value),
			)
			if (!repeated.issues) {
				assertBoundedRange(repeated.value, maxRangeBytes, maxRangeDepth)
			}
			if (
				repeated.issues ||
				canonicalize(result.value) !== canonicalize(repeated.value)
			) {
				throw new Error(
					`Mosaic Domain range schema must normalize idempotently.`,
				)
			}
			return {
				...selection,
				range: structuredClone(result.value),
			}
		}

		const resolve = async (
			requests: readonly MosaicDomainResidencyRequest<Identity, Range>[],
		): Promise<readonly ResolvedRequest<Identity>[]> => {
			if (connectionDisposed || disposed) {
				throw new Error(`This Mosaic Domain residency connection is disposed.`)
			}
			if (!Array.isArray(requests) || requests.length > maxRequests) {
				throw new Error(
					`Mosaic Domain residency requests exceed ${maxRequests}.`,
				)
			}
			const ids = new Set<string>()
			const resolved: ResolvedRequest<Identity>[] = []
			const resolvedUnion = new Set<string>()
			for (const request of requests) {
				if (!validId(request?.id) || ids.has(request.id)) {
					throw new Error(`A Mosaic Domain residency request ID is invalid.`)
				}
				ids.add(request.id)
				const selection = request.selection
				let candidates: readonly MosaicDomainMemberAddress<Identity>[]
				if (selection?.kind === `members`) {
					if (!Array.isArray(selection.addresses)) {
						throw new Error(`A Mosaic Domain member selection is invalid.`)
					}
					if (selection.addresses.length > maxResidentMembers) {
						throw new Error(
							`Mosaic Domain residency member selection exceeds ${maxResidentMembers}.`,
						)
					}
					candidates = selection.addresses
				} else if (selection?.kind === `range`) {
					const normalized = await normalizeRange(selection)
					// Range scope is authorized before the resolver can consult an index.
					await authorize({
						action: `resolve-range`,
						actor,
						selection: structuredClone(normalized),
						session,
					})
					const resolvedCandidates = await options.range!.resolve({
						domain: options.domain,
						limit: normalized.limit,
						member: normalized.member,
						range: structuredClone(normalized.range),
					})
					if (!Array.isArray(resolvedCandidates)) {
						throw new Error(`A Mosaic Domain range resolution is invalid.`)
					}
					if (resolvedCandidates.length > normalized.limit) {
						throw new Error(`A Mosaic Domain range resolver exceeded its limit.`)
					}
					candidates = structuredClone(resolvedCandidates)
				} else {
					throw new Error(`A Mosaic Domain residency selection is invalid.`)
				}

				const addresses = new Map<string, MosaicDomainMemberAddress<Identity>>()
				for (const candidate of candidates) {
					// Key normalization is complete before per-address authorization, and
					// authorization is complete before acquisition or value lookup.
					const parsed = await options.domain.parseAddress(candidate)
					if (parsed.member.role !== `durable`) {
						throw new Error(
							`Mosaic Domain residency accepts durable members only.`,
						)
					}
					if (
						selection.kind === `range` &&
						parsed.address.member !== selection.member
					) {
						throw new Error(`A Mosaic Domain range resolved another member.`)
					}
					const normalizedAddress = structuredClone(parsed.address)
					await authorize({
						action: `read-member`,
						actor,
						address: structuredClone(normalizedAddress),
						session,
					})
					addresses.set(
						mosaicDomainMemberAddressKey(normalizedAddress),
						normalizedAddress,
					)
				}
				for (const key of addresses.keys()) resolvedUnion.add(key)
				if (resolvedUnion.size > maxResidentMembers) {
					throw new Error(
						`Mosaic Domain resolved residency exceeds ${maxResidentMembers}.`,
					)
				}
				resolved.push({
					addresses: [...addresses.values()],
					id: request.id,
					kind: selection.kind,
				})
			}
			return resolved
		}

		const readCheckpoint = async (
			requests: readonly MosaicDomainResidencyRequest<Identity, Range>[],
		): Promise<MosaicDomainResidencyCheckpoint<Identity>> => {
			for (let attempt = 0; attempt < 8; attempt++) {
				const before = await batchConnection.recover()
				const resolved = await resolve(requests)
				const members = new Map<
					string,
					MosaicDomainResidencyCheckpoint<Identity>[`members`][number]
				>()
				for (const request of resolved) {
					for (const address of request.addresses) {
						const key = mosaicDomainMemberAddressKey(address)
						if (members.has(key)) continue
						const parsed = await options.domain.parseAddress(address)
						const acquired = await options.domain.acquire(parsed)
						const token =
							acquired.member.model?.kind === `transceiver`
								? getJsonTokenFromStore(
										options.domain.store,
										acquired.token as MutableAtomToken<AnyMosaicTransceiver>,
									)
								: acquired.token
						members.set(key, {
							address,
							value: structuredClone(
								getFromStore(options.domain.store, token),
							) as Json.Serializable,
						})
					}
				}
				const after = await batchConnection.recover()
				if (before.headRevision !== after.headRevision) continue
				const token = revisionToken(options.domain.identity, after.headRevision)
				return {
					headRevision: after.headRevision,
					members: [...members.values()],
					resolutions: resolved.map((request) => ({
						addresses: request.addresses,
						requestId: request.id,
						revisionToken: token,
					})),
				}
			}
			throw new Error(
				`Mosaic Domain residency could not stabilize a checkpoint.`,
			)
		}

		const subscribe = async (
			requests: readonly MosaicDomainResidencyRequest<Identity, Range>[],
			listener: (accepted: MosaicDomainResidencyAcceptedSlice<Identity>) => void,
		): Promise<() => void> => {
			const received = structuredClone(requests)
			let current = await resolve(received)
			let active = true
			let tail = Promise.resolve()
			const stop = batchConnection.subscribe((accepted) => {
				const deliver = tail.then(async () => {
					if (!active) return
					if (current.some(({ kind }) => kind === `range`)) {
						current = await resolve(received)
					}
					const union = new Set<string>()
					const invalidations = current.map((request) => {
						const keys = new Set(
							request.addresses.map(mosaicDomainMemberAddressKey),
						)
						for (const key of keys) union.add(key)
						let matchedOperationCount = 0
						for (const operation of accepted.batch.operations) {
							if (keys.has(mosaicDomainMemberAddressKey(operation.address))) {
								matchedOperationCount++
							}
						}
						return {
							matchedOperationCount,
							refresh: request.kind === `range`,
							requestId: request.id,
							revisionToken: revisionToken(
								options.domain.identity,
								accepted.revision,
							),
						}
					})
					const batch = sliceMosaicDomainAcceptedBatch<Identity>(
						accepted as MosaicAcceptedDomainBatchEnvelope<Identity>,
						union,
					)
					if (
						batch === undefined &&
						invalidations.every(({ refresh }) => !refresh)
					) {
						return
					}
					listener({
						...(batch === undefined ? {} : { batch }),
						invalidations,
						metadata: {
							actor: accepted.batch.actor,
							affectedMemberCount: accepted.batch.affectedMembers.length,
							batchId: accepted.batch.id,
							dependencyCount: accepted.batch.dependencies.length,
							group: accepted.batch.group,
							operationCount: accepted.batch.operations.length,
							revision: accepted.revision,
							revisionToken: revisionToken(
								options.domain.identity,
								accepted.revision,
							),
							session: accepted.batch.session,
						},
					})
				})
				tail = deliver.then(
					() => undefined,
					(error) => {
						options.domain.store.logger.error(
							`🐞`,
							`transaction`,
							`mosaic-domain-residency`,
							`A Mosaic Domain residency subscription failed.`,
							error,
						)
					},
				)
			})
			const unsubscribe = (): void => {
				if (!active) return
				active = false
				stop()
				subscriptions.delete(unsubscribe)
			}
			subscriptions.add(unsubscribe)
			return unsubscribe
		}

		const disposeConnection = (): void => {
			if (connectionDisposed) return
			connectionDisposed = true
			for (const stop of [...subscriptions]) stop()
			connectionDisposers.delete(disposeConnection)
		}
		connectionDisposers.add(disposeConnection)
		return {
			dispose: disposeConnection,
			hydrate: (requests) => readCheckpoint(structuredClone(requests)),
			propose: async (proposal) =>
				(await batchConnection.propose(proposal)) as Awaited<
					ReturnType<MosaicDomainResidencyTransport<Identity, Range>[`propose`]>
				>,
			subscribe,
		}
	}

	return {
		connect,
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			for (const dispose of [...connectionDisposers]) dispose()
			connectionDisposers.clear()
		},
	}
}
