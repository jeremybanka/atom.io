import {
	applyMosaicDomainBatch,
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
	type MosaicAcceptedDomainBatchEnvelope,
	type MosaicDomainBatchEnvelope,
	mosaicDomainBatchMeaningKey,
	type MosaicDomainBatchMemberOperation,
	type MosaicDomainBatchProjection,
	type MosaicDomainBatchProposal,
	type MosaicDomainBatchRejection,
	type MosaicDomainIdentity,
	type MosaicDomainInstance,
	type MosaicDomainMemberAddress,
	mosaicDomainMemberAddressKey,
	mosaicDomainMemberModelIdentity,
	preflightMosaicDomainBatch,
	type PreparedMosaicDomainBatch,
	type RealtimeRequestIdentity,
	type RealtimeSubmission,
	reprojectMosaicDomainBatches,
} from "@atom.io/realtime"
import type { Json } from "atom.io/foundations/json"

import { createRealtimeSubmission } from "./realtime-submission.ts"

export type MosaicDomainBatchClientTransport = {
	recover(afterRevision?: number): Promise<{
		readonly headRevision: number
		readonly tail: readonly MosaicAcceptedDomainBatchEnvelope[]
	}>
	propose(batch: MosaicDomainBatchProposal): Promise<
		| {
				readonly accepted: MosaicAcceptedDomainBatchEnvelope
				readonly status: `accepted`
		  }
		| {
				readonly rejection: MosaicDomainBatchRejection
				readonly status: `rejected`
		  }
	>
	subscribe(
		listener: (accepted: MosaicAcceptedDomainBatchEnvelope) => void,
	): () => void
}

export type MosaicDomainBatchClientState = {
	readonly pendingBatchIds: readonly string[]
	readonly problem: MosaicDomainBatchRejection | null
	readonly revision: number
	readonly status: `connecting` | `live` | `offline` | `recovering` | `rejected`
}

export type MosaicDomainBatchClientOperation = {
	readonly address: MosaicDomainMemberAddress
	readonly id?: string
	readonly operation: Json.Serializable
}

export type MosaicDomainBatchClientIdContext = {
	readonly actor: string
	readonly kind: `batch` | `operation`
	readonly sequence: number
	readonly session: string
}

export type MosaicDomainBatchSubmissionIdentity =
	RealtimeRequestIdentity<MosaicDomainIdentity> & {
		readonly actor: string
	}
export type MosaicDomainBatchSubmission = RealtimeSubmission<
	MosaicDomainBatchSubmissionIdentity,
	{ readonly revision: number },
	MosaicDomainBatchRejection
>
type SubmissionController = ReturnType<
	typeof createRealtimeSubmission<
		MosaicDomainBatchSubmissionIdentity,
		{ readonly revision: number },
		MosaicDomainBatchRejection
	>
>

export type MosaicDomainBatchClientOptions = {
	/** Called after local commit, before delivery. Exceptions are logged, not propagated. */
	readonly onSubmission?: (submission: MosaicDomainBatchSubmission) => void
	readonly actor: string
	readonly domain: MosaicDomainInstance<any, any, any>
	readonly idSource?: (context: MosaicDomainBatchClientIdContext) => string
	readonly session: string
	readonly transport: MosaicDomainBatchClientTransport
}

export type MosaicDomainBatchClient = Disposable & {
	flush(): Promise<void>
	start(): Promise<void>
	readonly state: MosaicDomainBatchClientState
	submit(
		operation:
			| MosaicDomainBatchClientOperation
			| readonly MosaicDomainBatchClientOperation[],
		group?: string | null,
	): Promise<MosaicDomainBatchSubmission>
	subscribe(listener: (state: MosaicDomainBatchClientState) => void): () => void
}

type Pending = {
	submission: SubmissionController
	prepared: PreparedMosaicDomainBatch
	proposal: MosaicDomainBatchProposal
}

const committedBatchAdopters = new WeakMap<
	MosaicDomainBatchClient,
	(
		prepare: (
			context: MosaicDomainBatchClientAdoptionContext,
		) => Promise<PreparedMosaicDomainBatch>,
		onSubmission?: (submission: MosaicDomainBatchSubmission) => void,
	) => Promise<MosaicDomainBatchSubmission>
>()

/** @internal Identity and ordering allocated by the owning batch client. */
export type MosaicDomainBatchClientAdoptionContext = {
	readonly actor: string
	readonly batchId: string
	readonly dependencies: readonly string[]
	operationId(): string
	readonly sequence: number
	readonly session: string
}

/** @internal Adopt Store-committed optimism without applying it again. */
export function adoptCommittedMosaicDomainBatchClientOptimism(
	client: MosaicDomainBatchClient,
	prepare: (
		context: MosaicDomainBatchClientAdoptionContext,
	) => Promise<PreparedMosaicDomainBatch>,
	onSubmission?: (submission: MosaicDomainBatchSubmission) => void,
): Promise<MosaicDomainBatchSubmission> {
	const adopt = committedBatchAdopters.get(client)
	if (adopt === undefined) {
		throw new Error(`A Mosaic Domain batch client adoption cannot be forged.`)
	}
	return adopt(prepare, onSubmission)
}

const defaultIdSource = ({
	actor,
	kind,
	sequence,
	session,
}: MosaicDomainBatchClientIdContext): string =>
	`${actor}:${session}:${kind}:${sequence}`

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
	`sequence-retired`,
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
		throw new Error(`The Mosaic Domain transport returned an invalid rejection.`)
	}
}

/**
 * Bind atomic Domain optimism/reprojection to one Store and client session.
 * Every local batch is one Store transaction, and outbound delivery begins only
 * after that transaction commits successfully.
 */
export function createMosaicDomainBatchClient(
	options: MosaicDomainBatchClientOptions,
): MosaicDomainBatchClient {
	const idSource = options.idSource ?? defaultIdSource
	const listeners = new Set<(state: MosaicDomainBatchClientState) => void>()
	const pending: Pending[] = []
	const logListenerError = (error: unknown): void => {
		options.domain.store.logger.error(
			`🐞`,
			`transaction`,
			`mosaic-domain-batch-client`,
			`A submission listener threw.`,
			error,
		)
	}
	const createSubmission = (
		proposal: MosaicDomainBatchProposal,
	): SubmissionController =>
		createRealtimeSubmission(
			Object.freeze({
				actor: options.actor,
				requestId: proposal.id,
				session: options.session,
				resource: Object.freeze({
					...options.domain.identity,
					definition: Object.freeze({ ...options.domain.identity.definition }),
				}),
			}),
			logListenerError,
		)
	const announce = (item: Pending, listener = options.onSubmission): void => {
		try {
			listener?.(item.submission.receipt)
		} catch (error) {
			logListenerError(error)
		}
	}
	let sequence = 0
	let batchSequence = 0
	let durableBatchSequence = 0
	let revision = 0
	let headBatchId: string | null = null
	let headBatchMeaningKey: string | null = null
	let problem: MosaicDomainBatchRejection | null = null
	let status: MosaicDomainBatchClientState[`status`] = `connecting`
	const deliveryWaiters = new Set<() => void>()
	let disposed = false
	let started = false
	let queue = Promise.resolve()
	let submitTail = Promise.resolve()

	const enqueue = <Value>(work: () => Promise<Value>): Promise<Value> => {
		const result = queue.then(work, work)
		queue = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}

	let cachedState: MosaicDomainBatchClientState | undefined
	const snapshot = (): MosaicDomainBatchClientState =>
		(cachedState ??= Object.freeze({
			pendingBatchIds: Object.freeze(pending.map(({ proposal }) => proposal.id)),
			problem,
			revision,
			status,
		}))

	const notify = (): void => {
		cachedState = undefined
		const state = snapshot()
		for (const listener of listeners) {
			try {
				listener(state)
			} catch (error) {
				options.domain.store.logger.error(
					`🐞`,
					`transaction`,
					`mosaic-domain-batch-client`,
					`A Mosaic Domain batch client listener threw.`,
					error,
				)
			}
		}
	}

	const dependencies = (): string[] => [
		...(headBatchId === null ? [] : [headBatchId]),
		...pending.map(({ proposal }) => proposal.id),
	]

	const rejectPending = async (
		rejection: MosaicDomainBatchRejection,
	): Promise<void> => {
		if (pending.length > 0) {
			await reprojectMosaicDomainBatches(
				options.domain,
				pending.map(({ prepared }) => prepared),
				[],
			)
			for (const item of pending)
				item.submission.update({
					status: `interrupted`,
					reason: `invalid-response`,
					recovery: `resnapshot`,
				})
			pending.splice(0, pending.length)
		}
		problem = rejection
		status = `rejected`
		notify()
	}

	const rejectProtocol = async (
		error: unknown,
		batchId: string | null,
	): Promise<void> => {
		options.domain.store.logger.error(
			`🐞`,
			`transaction`,
			`mosaic-domain-batch-client`,
			`Invalid authoritative response.`,
			error,
		)
		await rejectPending({
			batchId,
			code: `invalid-payload`,
			reason: `The Mosaic Domain transport returned an invalid response.`,
			recovery: `resnapshot`,
		})
	}

	const replaceProjection = async (
		confirmed: readonly MosaicDomainBatchProjection[],
		nextPending: readonly Pending[],
	): Promise<void> => {
		const projected = await reprojectMosaicDomainBatches(
			options.domain,
			pending.map(({ prepared }) => prepared),
			[
				...confirmed,
				...nextPending.map(({ prepared, proposal }) => ({
					batch: {
						...prepared.batch,
						actor: options.actor,
						dependencies: proposal.dependencies,
						sequence: proposal.sequence,
					},
					revision: null,
				})),
			],
		)
		pending.splice(
			0,
			pending.length,
			...nextPending.map((item, index) => ({
				...item,
				prepared: projected[confirmed.length + index],
			})),
		)
	}

	const applyAccepted = async (
		accepted: MosaicAcceptedDomainBatchEnvelope,
	): Promise<void> => {
		if (!Number.isSafeInteger(accepted.revision) || accepted.revision < 1) {
			throw new Error(
				`A Mosaic Domain accepted revision must be a positive safe integer.`,
			)
		}
		if (accepted.revision < revision) return
		if (accepted.revision === revision) {
			if (
				headBatchMeaningKey === null ||
				headBatchMeaningKey !== mosaicDomainBatchMeaningKey(accepted.batch)
			) {
				throw new Error(
					`Mosaic Domain revision ${revision} was replayed with conflicting content.`,
				)
			}
			if (
				accepted.batch.actor === options.actor &&
				accepted.batch.session === options.session
			) {
				durableBatchSequence = Math.max(
					durableBatchSequence,
					accepted.batch.sequence,
				)
				batchSequence = Math.max(batchSequence, durableBatchSequence)
			}
			return
		}
		if (accepted.revision !== revision + 1) {
			await recover()
			return
		}
		const ownIndex = pending.findIndex(
			({ proposal }) => proposal.id === accepted.batch.id,
		)
		if (ownIndex >= 0) {
			const expected = pending[ownIndex].prepared.batch
			if (
				mosaicDomainBatchMeaningKey(expected) !==
				mosaicDomainBatchMeaningKey(accepted.batch)
			) {
				await rejectPending({
					batchId: accepted.batch.id,
					code: `batch-id-collision`,
					reason: `An accepted batch reused a pending ID with different authenticated content.`,
					recovery: `resnapshot`,
				})
				return
			}
		}
		const ownSubmission = pending[ownIndex]?.submission
		// Accepted reduction has an authoritative revision and may not equal its
		// provisional projection. Compute the confirmed-plus-pending replacement
		// off-Store, then reveal it with one ordinary Store transaction.
		await replaceProjection(
			[
				{
					batch: accepted.batch,
					revision: accepted.revision,
				},
			],
			pending.filter((_item, index) => index !== ownIndex),
		)
		revision = accepted.revision
		headBatchId = accepted.batch.id
		headBatchMeaningKey = mosaicDomainBatchMeaningKey(accepted.batch)
		if (
			accepted.batch.actor === options.actor &&
			accepted.batch.session === options.session
		) {
			durableBatchSequence = Math.max(
				durableBatchSequence,
				accepted.batch.sequence,
			)
			batchSequence = Math.max(batchSequence, durableBatchSequence)
		}
		problem = null
		status = `live`
		cachedState = undefined
		ownSubmission?.update({
			status: `accepted`,
			value: Object.freeze({ revision: accepted.revision }),
		})
		notify()
	}

	const recover = async (): Promise<void> => {
		status = `recovering`
		notify()
		let recovery: Awaited<ReturnType<typeof options.transport.recover>>
		try {
			recovery = await options.transport.recover(revision)
		} catch (error) {
			status = `offline`
			notify()
			throw error
		}
		try {
			let recoveredRevision = revision
			let recoveredHeadBatchId = headBatchId
			let recoveredHeadBatchMeaningKey = headBatchMeaningKey
			let recoveredDurableBatchSequence = durableBatchSequence
			const recovered: MosaicDomainBatchProjection[] = []
			const settlements: {
				submission: SubmissionController
				revision: number
			}[] = []
			let nextPending = [...pending]
			for (const accepted of recovery.tail) {
				if (accepted.revision !== recoveredRevision + 1) {
					throw new Error(
						`Mosaic Domain recovery gap: expected ${recoveredRevision + 1}, received ${accepted.revision}.`,
					)
				}
				const ownIndex = nextPending.findIndex(
					({ proposal }) => proposal.id === accepted.batch.id,
				)
				if (ownIndex >= 0) {
					const expected = nextPending[ownIndex].prepared.batch
					if (
						mosaicDomainBatchMeaningKey(expected) !==
						mosaicDomainBatchMeaningKey(accepted.batch)
					) {
						await rejectPending({
							batchId: accepted.batch.id,
							code: `batch-id-collision`,
							reason: `An accepted recovery batch reused a pending ID with different authenticated content.`,
							recovery: `resnapshot`,
						})
						return
					}
					settlements.push({
						submission: nextPending[ownIndex].submission,
						revision: accepted.revision,
					})
					nextPending.splice(ownIndex, 1)
				}
				recovered.push({
					batch: accepted.batch,
					revision: accepted.revision,
				})
				recoveredRevision = accepted.revision
				recoveredHeadBatchId = accepted.batch.id
				recoveredHeadBatchMeaningKey = mosaicDomainBatchMeaningKey(
					accepted.batch,
				)
				if (
					accepted.batch.actor === options.actor &&
					accepted.batch.session === options.session
				) {
					recoveredDurableBatchSequence = Math.max(
						recoveredDurableBatchSequence,
						accepted.batch.sequence,
					)
				}
			}
			if (recoveredRevision !== recovery.headRevision) {
				throw new Error(`Mosaic Domain recovery returned an incomplete tail.`)
			}
			if (recovered.length > 0) {
				await replaceProjection(recovered, nextPending)
			}
			revision = recoveredRevision
			headBatchId = recoveredHeadBatchId
			headBatchMeaningKey = recoveredHeadBatchMeaningKey
			durableBatchSequence = recoveredDurableBatchSequence
			batchSequence = Math.max(batchSequence, durableBatchSequence)
			status = `live`
			problem = null
			cachedState = undefined
			for (const result of settlements)
				result.submission.update({
					status: `accepted`,
					value: Object.freeze({ revision: result.revision }),
				})
			notify()
		} catch (error) {
			await rejectProtocol(error, null)
			throw error
		}
	}

	const handleRejection = async (
		rejected: MosaicDomainBatchProposal,
		rejection: MosaicDomainBatchRejection,
	): Promise<void> => {
		const index = pending.findIndex(
			({ proposal }) => proposal.id === rejected.id,
		)
		if (index < 0) return
		const submission = pending[index].submission
		const nextPending = pending.filter((_item, itemIndex) => itemIndex !== index)
		let nextSequence = durableBatchSequence
		for (
			let pendingIndex = 0;
			pendingIndex < nextPending.length;
			pendingIndex++
		) {
			const previous = nextPending[pendingIndex]
			nextSequence++
			nextPending[pendingIndex] = {
				...previous,
				proposal: {
					...previous.proposal,
					dependencies: [
						...(headBatchId === null ? [] : [headBatchId]),
						...nextPending
							.slice(0, pendingIndex)
							.map(({ proposal }) => proposal.id),
					],
					sequence: nextSequence,
				},
			}
		}
		batchSequence = nextSequence
		await replaceProjection([], nextPending)
		problem = rejection
		status = `rejected`
		cachedState = undefined
		submission.update({
			status: `rejected`,
			rejection: Object.freeze({ ...rejection }),
			retryable: rejection.recovery === `retry`,
		})
		notify()
	}

	const send = async (item: Pending): Promise<void> => {
		if (disposed) return
		item.submission.update({ status: `sending` })
		let result: Awaited<ReturnType<typeof options.transport.propose>>
		try {
			result = await options.transport.propose(item.proposal)
		} catch {
			await enqueue(() => {
				if (
					disposed ||
					!pending.some(({ proposal }) => proposal.id === item.proposal.id)
				)
					return Promise.resolve()
				item.submission.update({ status: `offline` })
				status = `offline`
				notify()
				return Promise.resolve()
			})
			return
		}
		await enqueue(async () => {
			if (disposed) return
			try {
				if (result.status === `accepted`) {
					if (result.accepted.batch.id !== item.proposal.id)
						throw new Error(`An acceptance must identify its submitted batch.`)
					await applyAccepted(result.accepted)
				} else {
					assertRejection(result.rejection)
					if (result.rejection.batchId !== item.proposal.id)
						throw new Error(`A rejection must identify its submitted batch.`)
					await handleRejection(item.proposal, result.rejection)
				}
			} catch (error) {
				await rejectProtocol(error, item.proposal.id)
			}
		})
	}

	// Retain cancellation waiters only while a delivery is outstanding.
	const deliver = async (item: Pending): Promise<void> => {
		let release!: () => void
		const stopped = new Promise<void>((resolve) => {
			release = resolve
		})
		deliveryWaiters.add(release)
		try {
			await Promise.race([send(item), stopped])
		} finally {
			deliveryWaiters.delete(release)
		}
	}

	const unsubscribe = options.transport.subscribe((accepted) => {
		void enqueue(async () => {
			if (disposed) return
			try {
				await applyAccepted(accepted)
			} catch (error) {
				await rejectProtocol(error, null)
			}
		})
	})

	const client: MosaicDomainBatchClient = {
		async flush() {
			if (disposed)
				throw new Error(`This Mosaic Domain batch client is disposed.`)
			await submitTail
			await enqueue(recover)
			if (status !== `live`) return
			const queued = new Set(pending.map(({ proposal }) => proposal.id))
			while (status === `live`) {
				const item = pending.find(({ proposal }) => queued.has(proposal.id))
				if (item === undefined) break
				queued.delete(item.proposal.id)
				await deliver(item)
			}
		},
		async start() {
			if (disposed)
				throw new Error(`This Mosaic Domain batch client is disposed.`)
			if (started) return queue
			started = true
			return enqueue(recover)
		},
		get state() {
			return snapshot()
		},
		async submit(input, group = null) {
			const work = submitTail.then(async () => {
				if (disposed)
					throw new Error(`This Mosaic Domain batch client is disposed.`)
				if (!started) {
					try {
						await this.start()
					} catch (error) {
						if (status !== `offline`) throw error
					}
				}
				let item: Pending | undefined
				let sendImmediately = false
				await enqueue(async () => {
					if (disposed) {
						throw new Error(`This Mosaic Domain batch client is disposed.`)
					}
					const inputs = Array.isArray(input) ? input : [input]
					if (inputs.length === 0) {
						throw new Error(
							`A Mosaic Domain batch requires at least one operation.`,
						)
					}
					const batchId = idSource({
						actor: options.actor,
						kind: `batch`,
						sequence: sequence++,
						session: options.session,
					})
					const operations: MosaicDomainBatchMemberOperation[] = []
					for (const inputOperation of inputs) {
						const parsed = await options.domain.parseAddress(
							inputOperation.address,
						)
						if (
							parsed.member.role !== `durable` ||
							parsed.member.model === undefined
						) {
							throw new Error(
								`Mosaic Domain member "${inputOperation.address.member}" has no durable batch model.`,
							)
						}
						operations.push({
							address: structuredClone(inputOperation.address),
							id:
								inputOperation.id ??
								idSource({
									actor: options.actor,
									kind: `operation`,
									sequence: sequence++,
									session: options.session,
								}),
							model: mosaicDomainMemberModelIdentity(parsed.member.model),
							operation: structuredClone(inputOperation.operation),
						})
					}
					const affected = new Map<string, MosaicDomainMemberAddress>()
					for (const operation of operations) {
						affected.set(
							mosaicDomainMemberAddressKey(operation.address),
							operation.address,
						)
					}
					const nextBatchSequence = batchSequence + 1
					const proposed: MosaicDomainBatchProposal = {
						affectedMembers: [...affected.values()],
						dependencies: dependencies(),
						domain: options.domain.identity,
						group,
						id: batchId,
						operations,
						protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
						sequence: nextBatchSequence,
						session: options.session,
					}
					const envelope: MosaicDomainBatchEnvelope = {
						...proposed,
						actor: options.actor,
					}
					const prepared = await preflightMosaicDomainBatch(
						options.domain,
						envelope,
					)
					if (disposed)
						throw new Error(`This Mosaic Domain batch client is disposed.`)
					batchSequence = nextBatchSequence
					applyMosaicDomainBatch(prepared)
					item = {
						prepared,
						proposal: proposed,
						submission: createSubmission(proposed),
					}
					pending.push(item)
					cachedState = undefined
					announce(item)
					sendImmediately = status === `live`
					if (sendImmediately) problem = null
					else if (status === `offline`)
						item.submission.update({ status: `offline` })
					notify()
				})
				if (item === undefined)
					throw new Error(`A Mosaic Domain batch was not prepared.`)
				if (sendImmediately) await deliver(item)
				return item.submission.receipt
			})
			submitTail = work.then(
				() => undefined,
				() => undefined,
			)
			return work
		},
		subscribe(listener) {
			listeners.add(listener)
			listener(snapshot())
			return () => listeners.delete(listener)
		},
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			for (const release of deliveryWaiters) release()
			deliveryWaiters.clear()
			for (const item of pending)
				item.submission.update({
					status: `interrupted`,
					reason: `disposed`,
					recovery: `resnapshot`,
				})
			unsubscribe()
			listeners.clear()
		},
	}
	committedBatchAdopters.set(client, async (prepare, onSubmission) => {
		const work = submitTail.then(async () => {
			if (disposed)
				throw new Error(`This Mosaic Domain batch client is disposed.`)
			if (!started) {
				try {
					await client.start()
				} catch (error) {
					if (status !== `offline`) throw error
				}
			}
			let item: Pending | undefined
			let sendImmediately = false
			await enqueue(async () => {
				if (disposed) {
					throw new Error(`This Mosaic Domain batch client is disposed.`)
				}
				const batchId = idSource({
					actor: options.actor,
					kind: `batch`,
					sequence: sequence++,
					session: options.session,
				})
				const nextBatchSequence = batchSequence + 1
				const prepared = await prepare({
					actor: options.actor,
					batchId,
					dependencies: dependencies(),
					operationId: () =>
						idSource({
							actor: options.actor,
							kind: `operation`,
							sequence: sequence++,
							session: options.session,
						}),
					sequence: nextBatchSequence,
					session: options.session,
				})
				if (disposed)
					throw new Error(`This Mosaic Domain batch client is disposed.`)
				batchSequence = nextBatchSequence
				if (
					prepared.batch.actor !== options.actor ||
					prepared.batch.session !== options.session ||
					prepared.batch.domain.instance !== options.domain.identity.instance ||
					prepared.batch.domain.definition.key !==
						options.domain.identity.definition.key ||
					prepared.batch.domain.definition.version !==
						options.domain.identity.definition.version
				) {
					throw new Error(
						`Committed Mosaic Domain optimism belongs to another client identity or Domain.`,
					)
				}
				const { actor: _actor, ...proposal } = prepared.batch
				item = { prepared, proposal, submission: createSubmission(proposal) }
				pending.push(item)
				cachedState = undefined
				announce(item)
				if (onSubmission !== undefined) announce(item, onSubmission)
				sendImmediately = status === `live`
				if (sendImmediately) problem = null
				else if (status === `offline`)
					item.submission.update({ status: `offline` })
				notify()
			})
			if (item === undefined)
				throw new Error(`Committed Mosaic Domain optimism was not adopted.`)
			if (sendImmediately) await deliver(item)
			return item.submission.receipt
		})
		submitTail = work.then(
			() => undefined,
			() => undefined,
		)
		return work
	})
	return client
}
