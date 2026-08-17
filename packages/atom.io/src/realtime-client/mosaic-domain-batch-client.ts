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
	revertMosaicDomainBatch,
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

const defaultIdSource = ({
	actor,
	kind,
	sequence,
	session,
}: MosaicDomainBatchClientIdContext): string =>
	`${actor}:${session}:${kind}:${sequence}`

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
	let revision = 0
	let headBatchId: string | null = null
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

	const rollbackPending = (): void => {
		for (const item of [...pending].reverse()) {
			revertMosaicDomainBatch(item.prepared)
		}
	}

	const rejectProtocol = (error: unknown, batchId: string | null): void => {
		rollbackPending()
		problem = {
			batchId,
			code: `invalid-payload`,
			reason:
				error instanceof Error
					? error.message
					: `The Mosaic Domain transport returned an invalid response.`,
			recovery: `resnapshot`,
		}
		status = `rejected`
		notify()
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
				...nextPending.map(({ proposal }) => ({
					batch: { ...proposal, actor: options.actor },
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
		if (accepted.revision <= revision) return
		if (accepted.revision !== revision + 1) {
			await recover()
			return
		}
		const ownIndex = pending.findIndex(
			({ proposal }) => proposal.id === accepted.batch.id,
		)
		if (ownIndex >= 0) {
			const expected: MosaicDomainBatchEnvelope = {
				...pending[ownIndex].proposal,
				actor: options.actor,
			}
			if (
				mosaicDomainBatchMeaningKey(expected) !==
				mosaicDomainBatchMeaningKey(accepted.batch)
			) {
				rollbackPending()
				problem = {
					batchId: accepted.batch.id,
					code: `batch-id-collision`,
					reason: `An accepted batch reused a pending ID with different authenticated content.`,
					recovery: `resnapshot`,
				}
				status = `rejected`
				notify()
				return
			}
		}
		// Accepted reduction has an authoritative revision and may not equal its
		// provisional projection. Compute the confirmed-plus-pending replacement
		// off-Store, then reveal it with one ordinary Store transaction.
		await replaceProjection(
			[{ batch: accepted.batch, revision: accepted.revision }],
			pending.filter((_item, index) => index !== ownIndex),
		)
		revision = accepted.revision
		headBatchId = accepted.batch.id
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
					const expected: MosaicDomainBatchEnvelope = {
						...nextPending[ownIndex].proposal,
						actor: options.actor,
					}
					if (
						mosaicDomainBatchMeaningKey(expected) !==
						mosaicDomainBatchMeaningKey(accepted.batch)
					) {
						problem = {
							batchId: accepted.batch.id,
							code: `batch-id-collision`,
							reason: `An accepted recovery batch reused a pending ID with different authenticated content.`,
							recovery: `resnapshot`,
						}
						status = `rejected`
						rollbackPending()
						notify()
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
			}
			if (recoveredRevision !== recovery.headRevision) {
				throw new Error(`Mosaic Domain recovery returned an incomplete tail.`)
			}
			if (recovered.length > 0) {
				await replaceProjection(recovered, nextPending)
			}
			revision = recoveredRevision
			headBatchId = recoveredHeadBatchId
			status = `live`
			problem = null
			notify()
		} catch (error) {
			rejectProtocol(error, null)
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
		const nextPending = pending.filter((_item, itemIndex) => itemIndex !== index)
		for (
			let pendingIndex = 0;
			pendingIndex < nextPending.length;
			pendingIndex++
		) {
			const previous = nextPending[pendingIndex]
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
				},
			}
		}
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
			status = `offline`
			notify()
			return
		}
		await enqueue(async () => {
			try {
				await (result.status === `accepted`
					? applyAccepted(result.accepted)
					: handleRejection(item.proposal, result.rejection))
			} catch (error) {
				rejectProtocol(error, item.proposal.id)
			}
		})
	}

	const unsubscribe = options.transport.subscribe((accepted) => {
		void enqueue(async () => {
			try {
				await applyAccepted(accepted)
			} catch (error) {
				rejectProtocol(error, null)
			}
		})
	})

	return {
		async flush() {
			if (disposed)
				throw new Error(`This Mosaic Domain batch client is disposed.`)
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
						address: parsed.address,
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
				const proposal: MosaicDomainBatchProposal = {
					affectedMembers: [...affected.values()],
					dependencies: dependencies(),
					domain: options.domain.identity,
					group,
					id: batchId,
					operations,
					protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
					session: options.session,
				}
				const envelope: MosaicDomainBatchEnvelope = {
					...proposal,
					actor: options.actor,
				}
				const prepared = await preflightMosaicDomainBatch(
					options.domain,
					envelope,
				)
				applyMosaicDomainBatch(prepared)
				const item = { prepared, proposal }
				pending.push(item)
				status = `live`
				problem = null
				notify()
				await send(item)
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
}
