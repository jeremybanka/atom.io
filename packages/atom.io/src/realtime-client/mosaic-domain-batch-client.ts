import type { Json } from "atom.io/foundations/json"
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
	reprojectMosaicDomainBatches,
} from "atom.io/realtime"

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

export type MosaicDomainBatchClientOptions = {
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
	): Promise<void>
	subscribe(listener: (state: MosaicDomainBatchClientState) => void): () => void
}

type Pending = {
	prepared: PreparedMosaicDomainBatch
	proposal: MosaicDomainBatchProposal
}

const committedBatchAdopters = new WeakMap<
	MosaicDomainBatchClient,
	(
		prepare: (
			context: MosaicDomainBatchClientAdoptionContext,
		) => Promise<PreparedMosaicDomainBatch>,
	) => Promise<void>
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
): Promise<void> {
	const adopt = committedBatchAdopters.get(client)
	if (adopt === undefined) {
		throw new Error(`A Mosaic Domain batch client adoption cannot be forged.`)
	}
	return adopt(prepare)
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
	let sequence = 0
	let batchSequence = 0
	let durableBatchSequence = 0
	let revision = 0
	let headBatchId: string | null = null
	let headBatchMeaningKey: string | null = null
	let problem: MosaicDomainBatchRejection | null = null
	let status: MosaicDomainBatchClientState[`status`] = `connecting`
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

	const snapshot = (): MosaicDomainBatchClientState =>
		Object.freeze({
			pendingBatchIds: Object.freeze(pending.map(({ proposal }) => proposal.id)),
			problem,
			revision,
			status,
		})

	const notify = (): void => {
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
		await rejectPending({
			batchId,
			code: `invalid-payload`,
			reason:
				error instanceof Error
					? error.message
					: `The Mosaic Domain transport returned an invalid response.`,
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
		notify()
	}

	const send = async (item: Pending): Promise<void> => {
		let result: Awaited<ReturnType<typeof options.transport.propose>>
		try {
			result = await options.transport.propose(item.proposal)
		} catch {
			await enqueue(() => {
				if (!pending.includes(item)) return Promise.resolve()
				status = `offline`
				notify()
				return Promise.resolve()
			})
			return
		}
		await enqueue(async () => {
			try {
				if (result.status === `accepted`) {
					await applyAccepted(result.accepted)
				} else {
					assertRejection(result.rejection)
					await handleRejection(item.proposal, result.rejection)
				}
			} catch (error) {
				await rejectProtocol(error, item.proposal.id)
			}
		})
	}

	const unsubscribe = options.transport.subscribe((accepted) => {
		void enqueue(async () => {
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
				await send(item)
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
				if (!started) await this.start()
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
					batchSequence = nextBatchSequence
					applyMosaicDomainBatch(prepared)
					item = { prepared, proposal: proposed }
					pending.push(item)
					sendImmediately = status === `live`
					if (sendImmediately) problem = null
					notify()
				})
				if (sendImmediately) {
					if (item === undefined) {
						throw new Error(`A Mosaic Domain batch was not prepared.`)
					}
					await send(item)
				}
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
			unsubscribe()
			listeners.clear()
		},
	}
	committedBatchAdopters.set(client, async (prepare) => {
		const work = submitTail.then(async () => {
			if (disposed)
				throw new Error(`This Mosaic Domain batch client is disposed.`)
			if (!started) await client.start()
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
				item = { prepared, proposal }
				pending.push(item)
				sendImmediately = status === `live`
				if (sendImmediately) problem = null
				notify()
			})
			if (sendImmediately) {
				if (item === undefined) {
					throw new Error(`Committed Mosaic Domain optimism was not adopted.`)
				}
				await send(item)
			}
		})
		submitTail = work.then(
			() => undefined,
			() => undefined,
		)
		return work
	})
	return client
}
