import { createHash } from "node:crypto"

import {
	applyMosaicDomainBatch,
	assertMosaicDomainBatchEnvelope,
	DEFAULT_MOSAIC_DOMAIN_BATCH_LIMITS,
	type MosaicAcceptedDomainBatchEnvelope,
	type MosaicDomainBatchEnvelope,
	type MosaicDomainBatchLimits,
	mosaicDomainBatchMeaningKey,
	type MosaicDomainBatchProposal,
	type MosaicDomainBatchRejection,
	type MosaicDomainIdentity,
	type MosaicDomainInstance,
	preflightMosaicDomainBatch,
} from "atom.io/realtime"

import {
	InMemoryMosaicDomainBatchStorage,
	type MosaicDomainBatchRecovery,
	type MosaicDomainBatchStorageAdapter,
} from "./mosaic-domain-batch-storage.ts"

type MaybePromise<Value> = Promise<Value> | Value

export type MosaicDomainBatchAuthorizationContext = {
	readonly actor: string
	readonly batch: MosaicDomainBatchEnvelope
	readonly session: string
}

export type MosaicDomainBatchServerOptions = {
	readonly authorize?: (
		context: MosaicDomainBatchAuthorizationContext,
	) => MaybePromise<boolean>
	readonly domain: MosaicDomainInstance<any, any, any>
	readonly limits?: Partial<MosaicDomainBatchLimits> & {
		readonly maxPendingProposals?: number
	}
	readonly storage?: MosaicDomainBatchStorageAdapter
}

export type MosaicDomainBatchProposalResult =
	| {
			readonly accepted: MosaicAcceptedDomainBatchEnvelope
			readonly status: `accepted`
	  }
	| {
			readonly rejection: MosaicDomainBatchRejection
			readonly status: `rejected`
	  }

export type MosaicDomainBatchConnection = {
	recover(afterRevision?: number): Promise<MosaicDomainBatchRecovery>
	propose(
		batch: MosaicDomainBatchProposal,
	): Promise<MosaicDomainBatchProposalResult>
	subscribe(
		listener: (accepted: MosaicAcceptedDomainBatchEnvelope) => void,
	): () => void
}

export type MosaicDomainBatchServer = {
	connect(identity: {
		readonly actor: string
		readonly session: string
	}): MosaicDomainBatchConnection
	dispose(): void
	readonly revision: number
}

/** Fingerprint every durable and authenticated field in one Domain batch. */
export const fingerprintMosaicDomainBatch = (
	batch: MosaicDomainBatchEnvelope,
): string =>
	createHash(`sha256`).update(mosaicDomainBatchMeaningKey(batch)).digest(`hex`)

const rejection = (
	code: MosaicDomainBatchRejection[`code`],
	reason: string,
	batchId: string | null,
	recovery: MosaicDomainBatchRejection[`recovery`],
): MosaicDomainBatchProposalResult => ({
	rejection: { batchId, code, reason, recovery },
	status: `rejected`,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === `object` && value !== null && !Array.isArray(value)

const proposedBatchId = (value: unknown): string | null =>
	isRecord(value) && typeof value[`id`] === `string` ? value[`id`] : null

/**
 * Create one serialized, server-authoritative atomic Domain stream.
 *
 * Validation and model reduction happen before authorization, and persistence
 * happens before Store settlement/broadcast. An adapter append is the commit
 * point and must reserve every operation ID atomically.
 */
export function createMosaicDomainBatchServer(
	options: MosaicDomainBatchServerOptions,
): MosaicDomainBatchServer {
	const storage = options.storage ?? new InMemoryMosaicDomainBatchStorage()
	const limits: MosaicDomainBatchLimits = {
		...DEFAULT_MOSAIC_DOMAIN_BATCH_LIMITS,
		...options.limits,
	}
	const maxPendingProposals = options.limits?.maxPendingProposals ?? 64
	if (!Number.isSafeInteger(maxPendingProposals) || maxPendingProposals < 1) {
		throw new Error(`maxPendingProposals must be a positive safe integer.`)
	}
	for (const [name, value] of Object.entries(limits)) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new Error(`${name} must be a positive safe integer.`)
		}
	}

	let disposed = false
	let revision = 0
	let pendingProposals = 0
	let tail = Promise.resolve()
	const acceptedIds = new Set<string>()
	const listeners = new Set<
		(accepted: MosaicAcceptedDomainBatchEnvelope) => void
	>()

	const applyAccepted = async (
		accepted: MosaicAcceptedDomainBatchEnvelope,
	): Promise<void> => {
		if (accepted.revision !== revision + 1) {
			throw new Error(
				`Mosaic Domain revision gap: expected ${revision + 1}, received ${accepted.revision}.`,
			)
		}
		const prepared = await preflightMosaicDomainBatch(
			options.domain,
			accepted.batch,
			{
				limits,
				revision: accepted.revision,
			},
		)
		applyMosaicDomainBatch(prepared)
		revision = accepted.revision
		acceptedIds.add(accepted.batch.id)
	}

	const synchronize = async (): Promise<void> => {
		const recovery = await storage.recover(options.domain.identity, revision)
		if (recovery.headRevision < revision) {
			throw new Error(`Mosaic Domain storage moved behind resident state.`)
		}
		for (const accepted of recovery.tail) await applyAccepted(accepted)
		if (revision !== recovery.headRevision) {
			throw new Error(
				`Mosaic Domain storage returned an incomplete recovery tail.`,
			)
		}
	}

	const ready = synchronize()

	const processProposal = async (
		proposal: MosaicDomainBatchProposal,
		actor: string,
		session: string,
	): Promise<MosaicDomainBatchProposalResult> => {
		await ready
		const batchId = proposedBatchId(proposal)
		if (disposed) {
			return rejection(
				`backpressure`,
				`The Mosaic Domain server is disposed.`,
				batchId,
				`retry`,
			)
		}
		if (!isRecord(proposal)) {
			return rejection(
				`invalid-payload`,
				`A Mosaic Domain proposal must be an object.`,
				null,
				`discard-batch`,
			)
		}
		if (proposal.session !== session) {
			return rejection(
				`invalid-payload`,
				`The proposal session does not match its authenticated connection.`,
				batchId,
				`discard-batch`,
			)
		}
		await synchronize()
		let batch: MosaicDomainBatchEnvelope = { ...proposal, actor }
		try {
			assertMosaicDomainBatchEnvelope(batch, limits)
			batch = structuredClone(batch)
		} catch (error) {
			return rejection(
				String(error).includes(`protocol version`)
					? `incompatible-version`
					: String(error).includes(`exceed`)
						? `capacity-exceeded`
						: `invalid-payload`,
				error instanceof Error ? error.message : String(error),
				proposal.id ?? null,
				String(error).includes(`protocol version`) ? `upgrade` : `discard-batch`,
			)
		}

		const fingerprint = fingerprintMosaicDomainBatch(batch)
		const existing = await storage.receipt(options.domain.identity, batch.id)
		if (existing !== null) {
			return existing.fingerprint === fingerprint
				? { accepted: existing.accepted, status: `accepted` }
				: rejection(
						`batch-id-collision`,
						`Batch ID "${batch.id}" was already used for different authenticated content.`,
						batch.id,
						`discard-batch`,
					)
		}
		for (const dependency of batch.dependencies) {
			if (!acceptedIds.has(dependency)) {
				return rejection(
					`missing-dependency`,
					`Batch dependency "${dependency}" is not accepted.`,
					batch.id,
					`retry`,
				)
			}
		}

		let prepared
		try {
			prepared = await preflightMosaicDomainBatch(options.domain, batch, {
				limits,
				revision: revision + 1,
			})
			batch = prepared.batch
		} catch (error) {
			return rejection(
				`invalid-model-operation`,
				error instanceof Error ? error.message : String(error),
				batch.id,
				`discard-batch`,
			)
		}
		let authorized = true
		try {
			authorized =
				options.authorize === undefined ||
				(await options.authorize({ actor, batch, session }))
		} catch {
			authorized = false
		}
		if (!authorized) {
			return rejection(
				`unauthorized`,
				`The authenticated actor is not authorized for the complete batch.`,
				batch.id,
				`discard-batch`,
			)
		}
		if (disposed) {
			return rejection(
				`backpressure`,
				`The Mosaic Domain server was disposed before append.`,
				batch.id,
				`retry`,
			)
		}

		let appended = await storage.appendBatch({
			accepted: { batch, revision: revision + 1 },
			expectedRevision: revision,
			fingerprint,
		})
		if (appended.status === `stale`) {
			await synchronize()
			try {
				prepared = await preflightMosaicDomainBatch(options.domain, batch, {
					limits,
					revision: revision + 1,
				})
				batch = prepared.batch
			} catch (error) {
				return rejection(
					`gap`,
					error instanceof Error ? error.message : String(error),
					batch.id,
					`resnapshot`,
				)
			}
			appended = await storage.appendBatch({
				accepted: { batch, revision: revision + 1 },
				expectedRevision: revision,
				fingerprint,
			})
		}
		if (appended.status === `collision`) {
			return rejection(
				appended.collision === `batch`
					? `batch-id-collision`
					: `operation-id-collision`,
				`${appended.collision === `batch` ? `Batch` : `Operation`} ID "${appended.id}" was already used.`,
				batch.id,
				`discard-batch`,
			)
		}
		if (appended.status === `stale`) {
			return rejection(
				`backpressure`,
				`The authoritative Domain head changed while appending.`,
				batch.id,
				`retry`,
			)
		}
		if (appended.status === `duplicate`) {
			await synchronize()
			return { accepted: appended.accepted, status: `accepted` }
		}

		// The prepared projection was computed at the exact appended revision.
		applyMosaicDomainBatch(prepared)
		revision = appended.accepted.revision
		acceptedIds.add(batch.id)
		for (const listener of listeners) {
			try {
				listener(appended.accepted)
			} catch (error) {
				options.domain.store.logger.error(
					`🐞`,
					`transaction`,
					batch.id,
					`A Mosaic Domain batch listener threw after revision ${revision} committed.`,
					error,
				)
			}
		}
		return { accepted: appended.accepted, status: `accepted` }
	}

	return {
		connect({ actor, session }) {
			if (
				typeof actor !== `string` ||
				actor.length === 0 ||
				actor.length > 512 ||
				typeof session !== `string` ||
				session.length === 0 ||
				session.length > 512
			) {
				throw new Error(
					`A Mosaic Domain connection requires actor and session IDs.`,
				)
			}
			return {
				async propose(proposal) {
					if (pendingProposals >= maxPendingProposals) {
						return rejection(
							`backpressure`,
							`The Mosaic Domain proposal queue is full.`,
							proposedBatchId(proposal),
							`retry`,
						)
					}
					let received: MosaicDomainBatchProposal
					try {
						received = structuredClone(proposal)
					} catch (error) {
						return rejection(
							`invalid-payload`,
							error instanceof Error
								? error.message
								: `A Mosaic Domain proposal could not be cloned.`,
							proposedBatchId(proposal),
							`discard-batch`,
						)
					}
					pendingProposals++
					const result = tail.then(() =>
						processProposal(received, actor, session),
					)
					tail = result.then(
						() => undefined,
						() => undefined,
					)
					try {
						return await result
					} finally {
						pendingProposals--
					}
				},
				async recover(afterRevision = 0) {
					await ready
					return storage.recover(options.domain.identity, afterRevision)
				},
				subscribe(listener) {
					listeners.add(listener)
					return () => listeners.delete(listener)
				},
			}
		},
		dispose() {
			disposed = true
			listeners.clear()
		},
		get revision() {
			return revision
		},
	}
}
