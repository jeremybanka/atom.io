import {
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
	type MosaicAcceptedDomainBatchEnvelope,
	type MosaicDomainIdentity,
	type MosaicDomainMemberAddress,
	mosaicDomainMemberAddressKey,
} from "atom.io/realtime"
import {
	createMosaicDomainCheckpointCoordinator,
	type MosaicDomainCheckpointStorageAdapter,
} from "atom.io/realtime-server"

const identity: MosaicDomainIdentity = {
	definition: { key: `checkpoint-storage-conformance`, version: 1 },
	instance: `fixture`,
}

const address = (key: string): MosaicDomainMemberAddress => ({
	domain: identity,
	key,
	member: `items`,
})

const accepted = (
	id: string,
	revision: number,
	addresses: readonly MosaicDomainMemberAddress[],
): MosaicAcceptedDomainBatchEnvelope => ({
	batch: {
		affectedMembers: addresses,
		actor: `actor`,
		dependencies: [],
		domain: identity,
		group: null,
		id,
		operations: addresses.map((memberAddress, index) => ({
			address: memberAddress,
			id: `${id}:operation:${index}`,
			model: { key: `checkpoint-fixture`, version: 1 },
			operation: { type: `set` },
		})),
		protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
		session: `session`,
	},
	revision,
})

const assert = (condition: unknown, message: string): void => {
	if (!condition) {
		throw new Error(`Mosaic Domain checkpoint storage conformance: ${message}`)
	}
}

/** Exercise vendor-neutral checkpoint graph, fencing, paging, and GC rules. */
export async function testMosaicDomainCheckpointStorageAdapter(
	create: () => MosaicDomainCheckpointStorageAdapter,
): Promise<void> {
	const storage = create()
	const values = new Map<string, string>()
	const firstAddresses = [address(`a`), address(`b`)]
	for (const memberAddress of firstAddresses) {
		values.set(
			mosaicDomainMemberAddressKey(memberAddress),
			memberAddress.key as string,
		)
	}
	const firstBatch = accepted(`batch-1`, 1, firstAddresses)
	const append = await storage.appendBatch({
		accepted: firstBatch,
		expectedRevision: 0,
		fingerprint: `fingerprint-1`,
	})
	assert(append.status === `accepted`, `the fixture append was not accepted`)

	const coordinator = createMosaicDomainCheckpointCoordinator({
		domain: identity,
		readMember: ({ address: memberAddress }) =>
			values.get(mosaicDomainMemberAddressKey(memberAddress))!,
		storage,
	})
	const first = await coordinator.checkpoint()
	assert(first.revision === 1, `the first root did not publish at revision one`)
	const recovered = await coordinator.recover(firstAddresses)
	assert(
		recovered.members.length === 2 && recovered.tail.length === 0,
		`the published root could not recover its requested members`,
	)

	const enumerated = new Set<string>()
	let after: `sha256:${string}` | undefined
	do {
		const page = await storage.listCheckpointObjects(identity, {
			...(after === undefined ? {} : { after }),
			limit: 1,
		})
		for (const object of page.objects) enumerated.add(object.key)
		after = page.cursor ?? undefined
	} while (after !== undefined)
	assert(
		enumerated.has(first.rootKey) && enumerated.size >= 4,
		`stable cursor enumeration omitted checkpoint objects`,
	)

	const beforeRead = await storage.checkpointHead(identity)
	const read = await storage.openCheckpointRead(identity, `conformance-read`)
	assert(
		read.rootKey === first.rootKey && read.headRevision === 1,
		`a read view did not capture one root and head`,
	)
	const staleCollection = await storage.collectCheckpointGarbage({
		domain: identity,
		expectedRetentionEpoch: beforeRead.retentionEpoch,
	})
	assert(
		staleCollection.status === `stale`,
		`opening a protected read did not fence reclamation`,
	)
	await storage.deleteCheckpointRetentionLease(identity, `conformance-read`)

	await storage.upsertCheckpointRetentionLease(identity, {
		id: `supported-session`,
		kind: `session`,
		minimumRevision: 2,
		rootKeys: [first.rootKey],
	})
	const changed = address(`a`)
	values.set(mosaicDomainMemberAddressKey(changed), `changed`)
	await storage.appendBatch({
		accepted: accepted(`batch-2`, 2, [changed]),
		expectedRevision: 1,
		fingerprint: `fingerprint-2`,
	})
	const second = await coordinator.checkpoint()
	assert(
		second.rootKey !== first.rootKey && second.dirtyMemberCount === 1,
		`a dirty member did not create one incrementally published root`,
	)
	let epoch = (await storage.checkpointHead(identity)).retentionEpoch
	const protectedCollection = await storage.collectCheckpointGarbage({
		domain: identity,
		expectedRetentionEpoch: epoch,
	})
	assert(
		protectedCollection.status === `collected` &&
			(await storage.readCheckpointObject(identity, first.rootKey)) !== null,
		`a supported session did not preserve its checkpoint root`,
	)
	assert(
		(await storage.readCheckpointTail(identity, 1, 2)).length === 1,
		`a protected root did not independently preserve its required tail`,
	)
	await storage.deleteCheckpointRetentionLease(identity, `supported-session`)
	epoch = (await storage.checkpointHead(identity)).retentionEpoch
	const releasedCollection = await storage.collectCheckpointGarbage({
		domain: identity,
		expectedRetentionEpoch: epoch,
	})
	assert(
		releasedCollection.status === `collected` &&
			(await storage.readCheckpointObject(identity, first.rootKey)) === null,
		`an unreferenced checkpoint root was not reclaimed`,
	)

	const restarted = createMosaicDomainCheckpointCoordinator({
		domain: identity,
		readMember: ({ address: memberAddress }) =>
			values.get(mosaicDomainMemberAddressKey(memberAddress))!,
		storage,
	})
	const afterRestart = await restarted.recover(firstAddresses)
	assert(
		afterRestart.rootKey === second.rootKey &&
			afterRestart.members.find(
				({ address: memberAddress }) => memberAddress.key === `a`,
			)?.value === `changed`,
		`restart did not recover the current graph`,
	)
}
