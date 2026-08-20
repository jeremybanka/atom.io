import type {
	MosaicAcceptedDomainBatchEnvelope,
	MosaicDomainBatchEnvelope,
	MosaicDomainIdentity,
} from "atom.io/realtime"
import type { MosaicDomainBatchStorageAdapter } from "atom.io/realtime-server"

const identity: MosaicDomainIdentity = {
	definition: { key: `storage-conformance`, version: 1 },
	instance: `fixture`,
}

const batch = (
	id: string,
	operationIds: readonly string[],
	sequence: number,
): MosaicDomainBatchEnvelope => {
	const address = { domain: identity, member: `member` }
	return {
		affectedMembers: [address],
		actor: `actor`,
		dependencies: [],
		domain: identity,
		group: null,
		id,
		operations: operationIds.map((operationId) => ({
			address,
			id: operationId,
			model: { key: `fixture`, version: 1 },
			operation: { operationId },
		})),
		protocolVersion: 1,
		sequence,
		session: `session`,
	}
}

const accepted = (
	id: string,
	operationIds: readonly string[],
	revision: number,
): MosaicAcceptedDomainBatchEnvelope => ({
	batch: batch(id, operationIds, revision),
	revision,
})

const assert = (condition: unknown, message: string): void => {
	if (!condition)
		throw new Error(`Mosaic Domain storage conformance: ${message}`)
}

/**
 * Exercise the adapter invariants generic Domain servers rely upon.
 * Each invocation requires a fresh adapter over isolated durable state.
 */
export async function testMosaicDomainBatchStorageAdapter(
	create: () => MosaicDomainBatchStorageAdapter,
): Promise<void> {
	const storage = create()
	const first = accepted(`batch-1`, [`operation-1`], 1)
	const appended = await storage.appendBatch({
		accepted: first,
		expectedRevision: 0,
		fingerprint: `fingerprint-1`,
	})
	assert(appended.status === `accepted`, `the first append was not accepted`)

	const duplicate = await storage.appendBatch({
		accepted: first,
		expectedRevision: 0,
		fingerprint: `fingerprint-1`,
	})
	assert(
		duplicate.status === `duplicate`,
		`an identical retry was not idempotent`,
	)
	const batchCollision = await storage.appendBatch({
		accepted: {
			batch: {
				...first.batch,
				operations: first.batch.operations.map((operation) => ({
					...operation,
					operation: { changed: true },
				})),
			},
			revision: 1,
		},
		expectedRevision: 0,
		fingerprint: `fingerprint-conflict`,
	})
	assert(
		batchCollision.status === `collision` &&
			batchCollision.collision === `batch`,
		`conflicting batch-ID reuse did not fail closed`,
	)
	const next = accepted(`batch-sequence`, [`operation-sequence`], 2)
	const retired = await storage.appendBatch({
		accepted: { ...next, batch: { ...next.batch, sequence: 1 } },
		expectedRevision: 1,
		fingerprint: `fingerprint-retired`,
	})
	assert(
		retired.status === `retired` && retired.actualSequence === 1,
		`a retired per-session sequence was accepted`,
	)
	const gap = await storage.appendBatch({
		accepted: { ...next, batch: { ...next.batch, sequence: 3 } },
		expectedRevision: 1,
		fingerprint: `fingerprint-gap`,
	})
	assert(
		gap.status === `sequence-gap` && gap.actualSequence === 1,
		`a per-session sequence gap was accepted`,
	)

	const collision = await storage.appendBatch({
		accepted: accepted(`batch-2`, [`operation-2`, `operation-1`], 2),
		expectedRevision: 1,
		fingerprint: `fingerprint-2`,
	})
	assert(
		collision.status === `collision` && collision.collision === `operation`,
		`operation-ID reuse did not fail closed`,
	)
	assert(
		(await storage.receipt(identity, `batch-2`)) === null,
		`a rejected append left a batch receipt`,
	)
	const afterCollision = accepted(`batch-3`, [`operation-2`], 2)
	const acceptedAfterCollision = await storage.appendBatch({
		accepted: afterCollision,
		expectedRevision: 1,
		fingerprint: `fingerprint-3`,
	})
	assert(
		acceptedAfterCollision.status === `accepted`,
		`a failed append partially reserved a non-conflicting operation ID`,
	)

	const stale = await storage.appendBatch({
		accepted: accepted(`batch-4`, [`operation-4`], 4),
		expectedRevision: 3,
		fingerprint: `fingerprint-4`,
	})
	assert(stale.status === `stale`, `a stale expected revision was accepted`)

	const recovery = await storage.recover(identity)
	assert(recovery.headRevision === 2, `a failed append advanced the head`)
	assert(
		recovery.tail.length === 2 &&
			recovery.tail[0]?.batch.id === `batch-1` &&
			recovery.tail[1]?.batch.id === `batch-3`,
		`recovery did not preserve one contiguous accepted batch`,
	)
	const suffix = await storage.recover(identity, 1)
	assert(
		suffix.headRevision === 2 &&
			suffix.tail.length === 1 &&
			suffix.tail[0]?.batch.id === `batch-3`,
		`recovery did not honor its exclusive revision cursor`,
	)

	const concurrentStorage = create()
	const concurrent = await Promise.all([
		concurrentStorage.appendBatch({
			accepted: accepted(`batch-left`, [`operation-left`], 1),
			expectedRevision: 0,
			fingerprint: `fingerprint-left`,
		}),
		concurrentStorage.appendBatch({
			accepted: accepted(`batch-right`, [`operation-right`], 1),
			expectedRevision: 0,
			fingerprint: `fingerprint-right`,
		}),
	])
	assert(
		concurrent.filter(({ status }) => status === `accepted`).length === 1 &&
			concurrent.filter(({ status }) => status === `stale`).length === 1,
		`concurrent appends did not linearize at the expected revision`,
	)
	const concurrentRecovery = await concurrentStorage.recover(identity)
	assert(
		concurrentRecovery.headRevision === 1 &&
			concurrentRecovery.tail.length === 1,
		`concurrent appends produced a split or missing revision`,
	)
}
