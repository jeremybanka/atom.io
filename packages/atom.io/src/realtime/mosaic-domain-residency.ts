import type { Json } from "atom.io/foundations/json"

import type {
	MosaicDomainIdentity,
	MosaicDomainMemberAddress,
} from "./mosaic-domain.ts"
import {
	assertMosaicDomainBatchEnvelope,
	type MosaicAcceptedDomainBatchEnvelope,
	type MosaicDomainBatchMemberOperation,
	type MosaicDomainBatchProposal,
	type MosaicDomainBatchRejection,
	mosaicDomainMemberAddressKey,
} from "./mosaic-domain-batch.ts"

/** One directly addressed residency request. */
export type MosaicDomainMemberSelection<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly addresses: readonly MosaicDomainMemberAddress<Identity>[]
	readonly kind: `members`
}

/**
 * An application-defined, bounded range request. The server owns resolution;
 * core only transports its schema-normalized description and result limit.
 */
export type MosaicDomainRangeSelection<
	Range extends Json.Serializable = Json.Serializable,
> = {
	readonly kind: `range`
	readonly limit: number
	readonly member: string
	readonly range: Range
}

export type MosaicDomainResidencySelection<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
	Range extends Json.Serializable = Json.Serializable,
> = MosaicDomainMemberSelection<Identity> | MosaicDomainRangeSelection<Range>

/** A stable caller-owned selection identity within one connection. */
export type MosaicDomainResidencyRequest<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
	Range extends Json.Serializable = Json.Serializable,
> = {
	readonly id: string
	readonly selection: MosaicDomainResidencySelection<Identity, Range>
}

export type MosaicDomainResidentSnapshot<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly address: MosaicDomainMemberAddress<Identity>
	readonly value: Json.Serializable
}

/** The exact normalized addresses represented by one selection at a revision. */
export type MosaicDomainResidencyResolution<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly addresses: readonly MosaicDomainMemberAddress<Identity>[]
	readonly requestId: string
	readonly revisionToken: string
}

/** A consistent, bounded hydration cut for all requested selections. */
export type MosaicDomainResidencyCheckpoint<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly headRevision: number
	readonly members: readonly MosaicDomainResidentSnapshot<Identity>[]
	readonly resolutions: readonly MosaicDomainResidencyResolution<Identity>[]
}

/**
 * Bounded discovery metadata. Range subscribers refresh when membership may
 * have changed, without receiving the Domain's complete affected-address list.
 */
export type MosaicDomainResidencyInvalidation = {
	readonly matchedOperationCount: number
	readonly refresh: boolean
	readonly requestId: string
	readonly revisionToken: string
}

export type MosaicDomainResidencyBatchMetadata = {
	readonly actor: string
	readonly affectedMemberCount: number
	readonly batchId: string
	readonly dependencyCount: number
	readonly group: string | null
	readonly operationCount: number
	readonly revision: number
	readonly revisionToken: string
	readonly session: string
}

/**
 * A batch slice contains operations only for the connection's resolved scope.
 * `batch` is absent when a range needs discovery refresh but no currently
 * resident member was touched.
 */
export type MosaicDomainResidencyAcceptedSlice<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = {
	readonly batch?: MosaicAcceptedDomainBatchEnvelope<Identity>
	readonly invalidations: readonly MosaicDomainResidencyInvalidation[]
	readonly metadata: MosaicDomainResidencyBatchMetadata
}

export type MosaicDomainResidencyProposalResult<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> =
	| {
			readonly accepted: MosaicAcceptedDomainBatchEnvelope<Identity>
			readonly status: `accepted`
	  }
	| {
			readonly rejection: MosaicDomainBatchRejection
			readonly status: `rejected`
	  }

/** Headless transport seam shared by browser, worker, and test clients. */
export type MosaicDomainResidencyTransport<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
	Range extends Json.Serializable = Json.Serializable,
> = {
	dispose?(): void
	hydrate(
		requests: readonly MosaicDomainResidencyRequest<Identity, Range>[],
	): Promise<MosaicDomainResidencyCheckpoint<Identity>>
	propose(
		batch: MosaicDomainBatchProposal<Identity>,
	): Promise<MosaicDomainResidencyProposalResult<Identity>>
	subscribe(
		requests: readonly MosaicDomainResidencyRequest<Identity, Range>[],
		listener: (accepted: MosaicDomainResidencyAcceptedSlice<Identity>) => void,
	): Promise<() => void> | (() => void)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === `object` && value !== null && !Array.isArray(value)

const identifier = (value: unknown): value is string =>
	typeof value === `string` && value.length > 0 && value.length <= 512

/** Validate an untrusted filtered acceptance before it can affect a Store. */
export function assertMosaicDomainResidencyAcceptedSlice(
	value: unknown,
	maxInvalidations = 1024,
): asserts value is MosaicDomainResidencyAcceptedSlice {
	if (!isRecord(value) || !isRecord(value[`metadata`])) {
		throw new Error(`A Mosaic Domain residency acceptance is invalid.`)
	}
	const metadata = value[`metadata`]
	for (const field of [
		`actor`,
		`batchId`,
		`revisionToken`,
		`session`,
	] as const) {
		if (!identifier(metadata[field])) {
			throw new Error(`Mosaic Domain residency metadata is invalid.`)
		}
	}
	if (metadata[`group`] !== null && !identifier(metadata[`group`])) {
		throw new Error(`Mosaic Domain residency metadata is invalid.`)
	}
	for (const field of [
		`affectedMemberCount`,
		`dependencyCount`,
		`operationCount`,
	] as const) {
		if (
			!Number.isSafeInteger(metadata[field]) ||
			(metadata[field] as number) < 0
		) {
			throw new Error(`Mosaic Domain residency metadata is invalid.`)
		}
	}
	if (
		!Number.isSafeInteger(metadata[`revision`]) ||
		(metadata[`revision`] as number) < 1
	) {
		throw new Error(`Mosaic Domain residency metadata is invalid.`)
	}
	const invalidations = value[`invalidations`]
	if (!Array.isArray(invalidations) || invalidations.length > maxInvalidations) {
		throw new Error(`Mosaic Domain residency invalidations are invalid.`)
	}
	const requestIds = new Set<string>()
	for (const invalidation of invalidations) {
		if (
			!isRecord(invalidation) ||
			!identifier(invalidation[`requestId`]) ||
			requestIds.has(invalidation[`requestId`]) ||
			!identifier(invalidation[`revisionToken`]) ||
			invalidation[`revisionToken`] !== metadata[`revisionToken`] ||
			typeof invalidation[`refresh`] !== `boolean` ||
			!Number.isSafeInteger(invalidation[`matchedOperationCount`]) ||
			(invalidation[`matchedOperationCount`] as number) < 0 ||
			(invalidation[`matchedOperationCount`] as number) >
				(metadata[`operationCount`] as number)
		) {
			throw new Error(`Mosaic Domain residency invalidations are invalid.`)
		}
		requestIds.add(invalidation[`requestId`])
	}
	if (value[`batch`] === undefined) return
	if (!isRecord(value[`batch`])) {
		throw new Error(`A Mosaic Domain residency batch slice is invalid.`)
	}
	const accepted = value[`batch`] as unknown as MosaicAcceptedDomainBatchEnvelope
	if (accepted.revision !== metadata[`revision`]) {
		throw new Error(`A Mosaic Domain residency batch revision is invalid.`)
	}
	assertMosaicDomainBatchEnvelope(accepted.batch)
	if (
		accepted.batch.actor !== metadata[`actor`] ||
		accepted.batch.id !== metadata[`batchId`] ||
		accepted.batch.session !== metadata[`session`] ||
		accepted.batch.group !== metadata[`group`] ||
		accepted.batch.operations.length > (metadata[`operationCount`] as number) ||
		accepted.batch.affectedMembers.length >
			(metadata[`affectedMemberCount`] as number)
	) {
		throw new Error(`A Mosaic Domain residency batch slice is invalid.`)
	}
}

/** Filter an accepted batch while preserving the MOS-11 envelope contract. */
export function sliceMosaicDomainAcceptedBatch<
	Identity extends MosaicDomainIdentity,
>(
	accepted: MosaicAcceptedDomainBatchEnvelope<Identity>,
	addresses: ReadonlySet<string>,
): MosaicAcceptedDomainBatchEnvelope<Identity> | undefined {
	const operations: MosaicDomainBatchMemberOperation<Identity>[] = []
	for (const operation of accepted.batch.operations) {
		if (addresses.has(mosaicDomainMemberAddressKey(operation.address))) {
			operations.push(operation)
		}
	}
	if (operations.length === 0) return undefined
	const affected = new Map<string, MosaicDomainMemberAddress<Identity>>()
	for (const operation of operations) {
		affected.set(
			mosaicDomainMemberAddressKey(operation.address),
			operation.address,
		)
	}
	return structuredClone({
		batch: {
			...accepted.batch,
			affectedMembers: [...affected.values()],
			operations,
		},
		revision: accepted.revision,
	})
}
