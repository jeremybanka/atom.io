import { Silo } from "atom.io"
import {
	defaultMosaicDomainMemberCheckpoint,
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
	type MosaicAcceptedDomainBatchEnvelope,
	mosaicDomain,
	type MosaicDomainCheckpointObject,
	type MosaicDomainIdentity,
	type MosaicDomainMemberAddress,
	mosaicDomainMemberAddressKey,
	type MosaicDomainTransceiverModel,
	type MosaicDomainValueModel,
	mosaicText,
	type MosaicTextOperation,
	type MosaicTextSnapshot,
	projectMosaicDomainCheckpointMember,
} from "atom.io/realtime"
import {
	createMosaicDomainBatchServer,
	createMosaicDomainCheckpointCoordinator,
	createMosaicDomainResidencyServer,
	InMemoryMosaicDomainCheckpointStorage,
	type MosaicDomainCheckpointCommitRequest,
	type MosaicDomainCheckpointCommitResult,
	mosaicDomainCheckpointObjectKey,
	type MosaicDomainCheckpointStageResult,
	type MosaicDomainCheckpointStoredObject,
	stageMosaicDomainExternalCheckpointGraph,
} from "atom.io/realtime-server"
import {
	testMosaicDomainBatchStorageAdapter,
	testMosaicDomainCheckpointStorageAdapter,
} from "atom.io/realtime-testing"
import { vitest } from "vitest"
import { z } from "zod"

const identity: MosaicDomainIdentity = {
	definition: { key: `checkpoint-test`, version: 1 },
	instance: `document`,
}

const address = (key: string, member = `items`): MosaicDomainMemberAddress => ({
	domain: identity,
	key,
	member,
})

const accepted = (
	id: string,
	revision: number,
	addresses: readonly MosaicDomainMemberAddress[],
): MosaicAcceptedDomainBatchEnvelope => ({
	batch: {
		affectedMembers: addresses,
		actor: `actor-${revision % 2}`,
		dependencies: revision === 1 ? [] : [`batch-${revision - 1}`],
		domain: identity,
		group: `gesture-${Math.ceil(revision / 2)}`,
		id,
		operations: addresses.map((memberAddress, index) => ({
			address: memberAddress,
			id: `${id}:operation:${index}`,
			model: { key: `checkpoint-test-model`, version: 1 },
			operation: { type: `set` },
		})),
		protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
		sequence: Math.ceil(revision / 2),
		session: `session-${revision % 2}`,
	},
	revision,
})

const append = async (
	storage: InMemoryMosaicDomainCheckpointStorage,
	revision: number,
	addresses: readonly MosaicDomainMemberAddress[],
): Promise<void> => {
	const result = await storage.appendBatch({
		accepted: accepted(`batch-${revision}`, revision, addresses),
		expectedRevision: revision - 1,
		fingerprint: `fingerprint-${revision}`,
	})
	expect(result.status).toBe(`accepted`)
}

const fixture = (
	storage = new InMemoryMosaicDomainCheckpointStorage(),
	limits?: Parameters<
		typeof createMosaicDomainCheckpointCoordinator
	>[0][`limits`],
) => {
	const values = new Map<string, unknown>()
	const indexValues = new Map<string, unknown>()
	const coordinator = createMosaicDomainCheckpointCoordinator({
		domain: identity,
		indexes: ({ batches }) =>
			batches.flatMap((batch) =>
				batch.batch.affectedMembers.map((memberAddress) => {
					const path = String(memberAddress.key)
					return {
						index: `by-key`,
						path,
						value: (indexValues.get(path) ?? { present: true }) as never,
					}
				}),
			),
		...(limits === undefined ? {} : { limits }),
		readMember: ({ address: memberAddress }) =>
			values.get(mosaicDomainMemberAddressKey(memberAddress)) as never,
		storage,
	})
	return { coordinator, indexValues, storage, values }
}

describe(`Mosaic Domain incremental checkpoint graph`, () => {
	test(`the reference adapter satisfies batch and checkpoint storage conformance`, async () => {
		await testMosaicDomainBatchStorageAdapter(
			() => new InMemoryMosaicDomainCheckpointStorage(),
		)
		await testMosaicDomainCheckpointStorageAdapter(
			() => new InMemoryMosaicDomainCheckpointStorage(),
		)
	})

	test(`one bounded edit writes only one member and affected directory paths`, async () => {
		const { coordinator, indexValues, storage, values } = fixture()
		const corpus = Array.from({ length: 256 }, (_, index) =>
			address(`member-${index.toString().padStart(4, `0`)}`),
		)
		for (const memberAddress of corpus) {
			values.set(mosaicDomainMemberAddressKey(memberAddress), {
				body: `initial:${String(memberAddress.key)}`,
			})
		}
		await append(storage, 1, corpus)
		const initial = await coordinator.checkpoint()
		const changed = corpus[137]
		values.set(mosaicDomainMemberAddressKey(changed), { body: `changed` })
		indexValues.set(String(changed.key), { present: true, rank: 137 })
		await append(storage, 2, [changed])
		const incremental = await coordinator.checkpoint()

		expect(initial.dirtyMemberCount).toBe(256)
		expect(incremental).toMatchObject({
			dirtyIndexPathCount: 1,
			dirtyMemberCount: 1,
			revision: 2,
			status: `checkpointed`,
		})
		expect(incremental.persistedObjectCount).toBeLessThanOrEqual(10)
		expect(incremental.persistedBytes).toBeLessThan(initial.persistedBytes / 10)
		expect(
			(await coordinator.readIndex(`by-key`, String(changed.key)))?.value,
		).toEqual({ present: true, rank: 137 })
		const unchanged = await coordinator.recover([corpus[5], changed])
		expect(unchanged.members.map(({ value }) => value)).toEqual([
			{ body: `initial:member-0005` },
			{ body: `changed` },
		])
	})

	test(`published roots transitively protect staged external graphs without ad-hoc leases`, async () => {
		const storage = new InMemoryMosaicDomainCheckpointStorage({
			now: () => 1_000,
		})
		const memberAddress = address(`external-graph`)
		const values = new Map<string, unknown>([
			[mosaicDomainMemberAddressKey(memberAddress), `one`],
		])
		const firstExternal = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 1,
			domain: identity,
			proposal: {
				expiresAfterRevision: 1,
				expiresAt: 10_000,
				id: `staged-proposal`,
				minimumRevision: 0,
			},
			storage,
			updates: Array.from({ length: 32 }, (_, index) => ({
				index: `rope`,
				path: `node-${index.toString().padStart(2, `0`)}`,
				value: { text: `fragment-${index}` },
			})),
		})
		const companionExternal = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 1,
			domain: identity,
			proposal: {
				expiresAfterRevision: 1,
				expiresAt: 10_000,
				id: `staged-companion`,
				minimumRevision: 0,
			},
			storage,
			updates: [{ index: `thumbnail`, path: `root`, value: { color: `gold` } }],
		})
		let epoch = (await storage.checkpointHead(identity)).retentionEpoch
		await storage.collectCheckpointGarbage({
			domain: identity,
			expectedRetentionEpoch: epoch,
		})
		expect(
			await storage.readCheckpointObject(identity, firstExternal.rootKey),
		).not.toBeNull()
		let externalRoots: readonly `sha256:${string}`[] = [
			firstExternal.rootKey,
			companionExternal.rootKey,
		]
			.sort()
			.reverse()
		const coordinator = createMosaicDomainCheckpointCoordinator({
			domain: identity,
			externalRoots: () => externalRoots,
			limits: { maxExternalReads: 2 },
			readMember: ({ address: requested }) =>
				values.get(mosaicDomainMemberAddressKey(requested)) as string,
			storage,
		})
		await append(storage, 1, [memberAddress])
		const firstCheckpoint = await coordinator.checkpoint()
		await storage.deleteCheckpointRetentionLease(identity, `staged-proposal`)
		await storage.deleteCheckpointRetentionLease(identity, `staged-companion`)
		expect((await coordinator.recover([])).root.externalRoots).toEqual(
			[companionExternal.rootKey, firstExternal.rootKey].sort(),
		)
		expect(
			await coordinator.readExternalIndexes(firstExternal.rootKey, [
				{ index: `rope`, path: `node-00` },
				{ index: `rope`, path: `node-31` },
			]),
		).toMatchObject([
			{ path: `node-00`, value: { text: `fragment-0` } },
			{ path: `node-31`, value: { text: `fragment-31` } },
		])
		await expect(
			coordinator.readExternalIndexes(firstExternal.rootKey, [
				{ index: `rope`, path: `node-00` },
				{ index: `rope`, path: `node-01` },
				{ index: `rope`, path: `node-02` },
			]),
		).rejects.toThrow(`reads exceed 2`)
		const retiredIndex = (
			await coordinator.readExternalIndexes(firstExternal.rootKey, [
				{ index: `rope`, path: `node-17` },
			])
		)[0]
		const retiredIndexKey = mosaicDomainCheckpointObjectKey(retiredIndex)

		for (const kind of [`history`, `outbox`] as const) {
			await storage.upsertCheckpointRetentionLease(identity, {
				id: `external-${kind}`,
				kind,
				minimumRevision: 1,
				rootKeys: [firstCheckpoint.rootKey],
			})
		}
		const secondExternal = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 2,
			domain: identity,
			previousRootKey: firstExternal.rootKey,
			proposal: {
				expiresAfterRevision: 2,
				expiresAt: 10_000,
				id: `second-proposal`,
				minimumRevision: 1,
			},
			storage,
			updates: [
				{ index: `rope`, path: `node-17`, remove: true },
				{ index: `rope`, path: `node-new`, value: { text: `changed` } },
			],
		})
		expect(secondExternal.persistedObjectCount).toBeLessThan(
			firstExternal.persistedObjectCount,
		)
		externalRoots = [secondExternal.rootKey]
		values.set(mosaicDomainMemberAddressKey(memberAddress), `two`)
		await append(storage, 2, [memberAddress])
		await coordinator.checkpoint()
		await storage.deleteCheckpointRetentionLease(identity, `second-proposal`)
		expect(
			await coordinator.readExternalIndexes(secondExternal.rootKey, [
				{ index: `rope`, path: `node-17` },
				{ index: `rope`, path: `node-new` },
			]),
		).toMatchObject([{ path: `node-new`, value: { text: `changed` } }])

		epoch = (await storage.checkpointHead(identity)).retentionEpoch
		await storage.collectCheckpointGarbage({
			domain: identity,
			expectedRetentionEpoch: epoch,
		})
		expect(
			await storage.readCheckpointObject(identity, firstExternal.rootKey),
		).not.toBeNull()
		await storage.deleteCheckpointRetentionLease(identity, `external-history`)
		epoch = (await storage.checkpointHead(identity)).retentionEpoch
		await storage.collectCheckpointGarbage({
			domain: identity,
			expectedRetentionEpoch: epoch,
		})
		expect(
			await storage.readCheckpointObject(identity, firstExternal.rootKey),
		).not.toBeNull()
		await storage.deleteCheckpointRetentionLease(identity, `external-outbox`)
		epoch = (await storage.checkpointHead(identity)).retentionEpoch
		await storage.collectCheckpointGarbage({
			domain: identity,
			expectedRetentionEpoch: epoch,
		})
		expect(
			await storage.readCheckpointObject(identity, firstExternal.rootKey),
		).toBeNull()
		expect(
			await storage.readCheckpointObject(identity, retiredIndexKey),
		).toBeNull()
		expect(
			await storage.readCheckpointObject(identity, secondExternal.rootKey),
		).not.toBeNull()
	})

	test(`unpublished external graphs are unreachable and malformed dependencies fail closed`, async () => {
		const stagedOnlyStorage = new InMemoryMosaicDomainCheckpointStorage()
		const stagedOnly = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 0,
			domain: identity,
			storage: stagedOnlyStorage,
			updates: [{ index: `rope`, path: `root`, value: { text: `staged` } }],
		})
		await stagedOnlyStorage.collectCheckpointGarbage({
			domain: identity,
			expectedRetentionEpoch: 0,
		})
		expect(
			await stagedOnlyStorage.readCheckpointObject(identity, stagedOnly.rootKey),
		).toBeNull()

		class TamperingStorage extends InMemoryMosaicDomainCheckpointStorage {
			public tamper: `sha256:${string}` | null = null

			public override readCheckpointObject(
				domain: MosaicDomainIdentity,
				key: `sha256:${string}`,
			): MosaicDomainCheckpointObject | null {
				const value = super.readCheckpointObject(domain, key)
				return key === this.tamper && value?.kind === `external-root`
					? { ...value, bytes: value.bytes + 1 }
					: value
			}
		}
		const storage = new TamperingStorage()
		const external = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 1,
			domain: identity,
			storage,
			updates: [{ index: `rope`, path: `root`, value: { text: `safe` } }],
		})
		expect(
			await stageMosaicDomainExternalCheckpointGraph({
				baseRevision: 2,
				domain: identity,
				previousRootKey: external.rootKey,
				storage,
				updates: [],
			}),
		).toMatchObject({ bytes: external.bytes })
		storage.tamper = external.rootKey
		await append(storage, 1, [address(`tamper`)])
		const coordinator = createMosaicDomainCheckpointCoordinator({
			domain: identity,
			externalRoots: () => [external.rootKey],
			readMember: () => `value`,
			storage,
		})
		await expect(coordinator.checkpoint()).rejects.toThrow(`content key`)
		expect((await storage.checkpointHead(identity)).rootKey).toBeNull()

		storage.tamper = null
		const stagedExternal = await storage.readCheckpointObject(
			identity,
			external.rootKey,
		)
		if (stagedExternal?.kind !== `external-root`) {
			throw new Error(`The staged external root fixture is missing.`)
		}
		const inaccurate = {
			...stagedExternal,
			bytes: stagedExternal.bytes + 1,
		}
		const inaccurateKey = mosaicDomainCheckpointObjectKey(inaccurate)
		await storage.stageCheckpointObjects(identity, [
			{ key: inaccurateKey, value: inaccurate },
		])
		const inaccurateCoordinator = createMosaicDomainCheckpointCoordinator({
			domain: identity,
			externalRoots: () => [inaccurateKey],
			readMember: () => `value`,
			storage,
		})
		await expect(inaccurateCoordinator.checkpoint()).rejects.toThrow(
			`external checkpoint summary is invalid`,
		)

		const malformed = {
			baseRevision: 2,
			bytes: -1,
			depth: 65,
			directory: null,
			domain: identity,
			kind: `external-root`,
		} as const
		const malformedKey = mosaicDomainCheckpointObjectKey(malformed)
		await storage.stageCheckpointObjects(identity, [
			{ key: malformedKey, value: malformed },
		])
		const malformedCoordinator = createMosaicDomainCheckpointCoordinator({
			domain: identity,
			externalRoots: () => [malformedKey],
			readMember: () => `value`,
			storage,
		})
		await expect(malformedCoordinator.checkpoint()).rejects.toThrow(
			`external checkpoint root is invalid`,
		)
	})

	test(`atomic proposal staging is idempotent, fenced, and expires after abandonment`, async () => {
		let now = 1_000
		const storage = new InMemoryMosaicDomainCheckpointStorage({ now: () => now })
		const stage = () =>
			stageMosaicDomainExternalCheckpointGraph({
				baseRevision: 1,
				domain: identity,
				proposal: {
					expiresAfterRevision: 1,
					expiresAt: 2_000,
					id: `atomic-proposal`,
					minimumRevision: 0,
					retentionEpochs: 4,
				},
				storage,
				updates: [{ index: `rope`, path: `root`, value: { text: `safe` } }],
			})
		const first = await stage()
		const stagedEpoch = (await storage.checkpointHead(identity)).retentionEpoch
		const duplicate = await stage()
		expect(duplicate).toMatchObject({
			persistedBytes: 0,
			persistedObjectCount: 0,
			rootKey: first.rootKey,
		})
		expect((await storage.checkpointHead(identity)).retentionEpoch).toBe(
			stagedEpoch,
		)
		expect(
			await storage.collectCheckpointGarbage({
				domain: identity,
				expectedRetentionEpoch: 0,
			}),
		).toMatchObject({ status: `stale` })
		expect(
			await storage.readCheckpointObject(identity, first.rootKey),
		).not.toBeNull()
		now = 2_000
		expect(
			await storage.collectCheckpointGarbage({
				domain: identity,
				expectedRetentionEpoch: stagedEpoch,
			}),
		).toMatchObject({ status: `collected` })
		expect(
			await storage.readCheckpointObject(identity, first.rootKey),
		).toBeNull()
		expect(storage.stats(identity).retentionLeaseCount).toBe(0)

		const failed = new InMemoryMosaicDomainCheckpointStorage({ now: () => now })
		await expect(
			stageMosaicDomainExternalCheckpointGraph({
				baseRevision: 1,
				domain: identity,
				proposal: {
					expiresAfterRevision: 1,
					expiresAt: now,
					id: `expired-before-publish`,
					minimumRevision: 0,
				},
				storage: failed,
				updates: [{ index: `rope`, path: `root`, value: `not-visible` }],
			}),
		).rejects.toThrow(`proposal is invalid`)
		expect(failed.stats(identity)).toMatchObject({
			objectCount: 0,
			retentionLeaseCount: 0,
		})

		now = 3_000
		const acceptedStorage = new InMemoryMosaicDomainCheckpointStorage({
			now: () => now,
		})
		const acceptedStage = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 1,
			domain: identity,
			proposal: {
				expiresAfterRevision: 1,
				expiresAt: 4_000,
				id: `accepted-crash`,
				minimumRevision: 0,
			},
			storage: acceptedStorage,
			updates: [{ index: `rope`, path: `root`, value: `accepted` }],
		})
		await append(acceptedStorage, 1, [address(`accepted-crash`)])
		await expect(
			stageMosaicDomainExternalCheckpointGraph({
				baseRevision: 1,
				domain: identity,
				proposal: {
					expiresAfterRevision: 1,
					expiresAt: 4_000,
					id: `already-missed-revision`,
					minimumRevision: 0,
				},
				storage: acceptedStorage,
				updates: [{ index: `rope`, path: `missed`, value: `missed` }],
			}),
		).rejects.toThrow(`proposal is invalid`)
		const acceptedEpoch = (await acceptedStorage.checkpointHead(identity))
			.retentionEpoch
		await acceptedStorage.collectCheckpointGarbage({
			domain: identity,
			expectedRetentionEpoch: acceptedEpoch,
		})
		expect(
			await acceptedStorage.readCheckpointObject(
				identity,
				acceptedStage.rootKey,
			),
		).toBeNull()
	})

	test(`accepted external roots cross expiry and crash until checkpoint adoption`, async () => {
		let lateNow = 900
		const lateStorage = new InMemoryMosaicDomainCheckpointStorage({
			now: () => lateNow,
		})
		const lateStage = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 1,
			domain: identity,
			proposal: {
				expiresAfterRevision: 1,
				expiresAt: 1_000,
				id: `expired-before-append`,
				minimumRevision: 0,
			},
			storage: lateStorage,
			updates: [{ index: `rope`, path: `root`, value: `late` }],
		})
		lateNow = 1_000
		expect(() =>
			lateStorage.appendBatch({
				accepted: accepted(`batch-1`, 1, [address(`late-root`)]),
				checkpointProposals: [
					{ id: `expired-before-append`, rootKey: lateStage.rootKey },
				],
				expectedRevision: 0,
				fingerprint: `late-root-fingerprint`,
			}),
		).toThrow(`append proposal is invalid`)
		const lateEpoch = (await lateStorage.checkpointHead(identity)).retentionEpoch
		await lateStorage.collectCheckpointGarbage({
			domain: identity,
			expectedRetentionEpoch: lateEpoch,
		})
		expect(
			await lateStorage.readCheckpointObject(identity, lateStage.rootKey),
		).toBeNull()

		let now = 900
		const storage = new InMemoryMosaicDomainCheckpointStorage({ now: () => now })
		const memberAddress = address(`accepted-root`)
		const proposal = {
			expiresAfterRevision: 1,
			expiresAt: 1_000,
			id: `accepted-root-proposal`,
			minimumRevision: 0,
			retentionEpochs: 1,
		}
		const stage = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 1,
			domain: identity,
			proposal,
			storage,
			updates: [{ index: `rope`, path: `root`, value: `accepted` }],
		})
		const acceptedEnvelope = accepted(`batch-1`, 1, [memberAddress])
		const appendRequest = {
			accepted: acceptedEnvelope,
			checkpointProposals: [{ id: proposal.id, rootKey: stage.rootKey }],
			expectedRevision: 0,
			fingerprint: `accepted-root-fingerprint`,
		}
		const beforeAppendEpoch = (await storage.checkpointHead(identity))
			.retentionEpoch
		expect(await storage.appendBatch(appendRequest)).toMatchObject({
			status: `accepted`,
		})
		expect(await storage.appendBatch(appendRequest)).toMatchObject({
			status: `duplicate`,
		})
		expect(
			await storage.appendBatch({
				...appendRequest,
				checkpointProposals: [
					{ id: `different-proposal`, rootKey: stage.rootKey },
				],
			}),
		).toMatchObject({ collision: `batch`, status: `collision` })
		expect(
			await storage.collectCheckpointGarbage({
				domain: identity,
				expectedRetentionEpoch: beforeAppendEpoch,
			}),
		).toMatchObject({ status: `stale` })

		// Both proposal expiry mechanisms have elapsed after acceptance. The durable
		// accepted record, not the old proposal lease, now owns protection.
		now = 10_000
		const restarted = storage.restart()
		expect(restarted.stats(identity)).toMatchObject({
			acceptedRootProtectionCount: 1,
			retentionLeaseCount: 0,
		})
		let epoch = (await restarted.checkpointHead(identity)).retentionEpoch
		expect(
			await restarted.collectCheckpointGarbage({
				domain: identity,
				expectedRetentionEpoch: epoch,
			}),
		).toMatchObject({ status: `collected` })
		expect(
			await restarted.readCheckpointObject(identity, stage.rootKey),
		).not.toBeNull()

		const head = await restarted.checkpointHead(identity)
		const omittedRoot = {
			domain: identity,
			externalRoots: [],
			indexDirectory: null,
			kind: `root`,
			memberDirectory: null,
			protocolVersion: 1,
			retentionEpoch: head.retentionEpoch + 1,
			revision: 1,
		} as const
		const omittedRootKey = mosaicDomainCheckpointObjectKey(omittedRoot)
		await restarted.stageCheckpointObjects(identity, [
			{ key: omittedRootKey, value: omittedRoot },
		])
		expect(() =>
			restarted.commitCheckpoint({
				domain: identity,
				expectedRetentionEpoch: head.retentionEpoch,
				expectedRevision: 1,
				expectedRootKey: null,
				rootKey: omittedRootKey,
			}),
		).toThrow(`omitted an accepted external root`)

		const coordinator = createMosaicDomainCheckpointCoordinator({
			domain: identity,
			readMember: () => `accepted`,
			storage: restarted,
		})
		await coordinator.checkpoint()
		expect(restarted.stats(identity).acceptedRootProtectionCount).toBe(0)
		expect(
			await restarted.readCheckpointObject(identity, stage.rootKey),
		).not.toBeNull()

		await append(restarted, 2, [memberAddress])
		await createMosaicDomainCheckpointCoordinator({
			domain: identity,
			externalRoots: () => [],
			readMember: () => `later`,
			storage: restarted,
		}).checkpoint()
		epoch = (await restarted.checkpointHead(identity)).retentionEpoch
		await restarted.collectCheckpointGarbage({
			domain: identity,
			expectedRetentionEpoch: epoch,
		})
		expect(
			await restarted.readCheckpointObject(identity, stage.rootKey),
		).toBeNull()
	})

	test(`incremental external publication authenticates only dirty paths after restart`, async () => {
		const storage = new InMemoryMosaicDomainCheckpointStorage({
			now: () => 1_000,
		})
		const memberAddress = address(`bounded-external-proof`)
		let memberValue = `one`
		let externalRoot = (
			await stageMosaicDomainExternalCheckpointGraph({
				baseRevision: 1,
				domain: identity,
				proposal: {
					expiresAfterRevision: 1,
					expiresAt: 100_000,
					id: `proof-initial`,
					minimumRevision: 0,
				},
				storage,
				updates: Array.from({ length: 512 }, (_, index) => ({
					index: `rope`,
					path: `node-${index.toString().padStart(4, `0`)}`,
					value: { text: `fragment-${index}` },
				})),
			})
		).rootKey
		await append(storage, 1, [memberAddress])
		const publishedStorage = storage.restart()
		const initialCoordinator = createMosaicDomainCheckpointCoordinator({
			domain: identity,
			externalRoots: () => [externalRoot],
			readMember: () => memberValue,
			storage: publishedStorage,
		})
		await initialCoordinator.checkpoint()
		await publishedStorage.deleteCheckpointRetentionLease(
			identity,
			`proof-initial`,
		)

		const restarted = publishedStorage.restart()
		const before = restarted.stats(identity)
		const local = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 2,
			domain: identity,
			previousRootKey: externalRoot,
			proposal: {
				expiresAfterRevision: 2,
				expiresAt: 100_000,
				id: `proof-local`,
				minimumRevision: 1,
			},
			storage: restarted,
			updates: [
				{ index: `rope`, path: `node-0256`, remove: true },
				{ index: `rope`, path: `node-new`, value: { text: `local` } },
			],
		})
		const afterStage = restarted.stats(identity)
		expect(local.persistedObjectCount).toBeLessThan(24)
		expect(
			afterStage.externalValidationObjectReads -
				before.externalValidationObjectReads,
		).toBeLessThan(48)
		expect(
			afterStage.externalValidationSerializedBytes -
				before.externalValidationSerializedBytes,
		).toBeLessThan(1_024)
		expect(
			afterStage.externalValidationHashedBytes -
				before.externalValidationHashedBytes,
		).toBeLessThan(128 * 1_024)

		externalRoot = local.rootKey
		memberValue = `two`
		await append(restarted, 2, [memberAddress])
		const restartedCoordinator = createMosaicDomainCheckpointCoordinator({
			domain: identity,
			externalRoots: () => [externalRoot],
			readMember: () => memberValue,
			storage: restarted,
		})
		await restartedCoordinator.checkpoint()
		expect(restarted.stats(identity)).toMatchObject({
			externalValidationHashedBytes: afterStage.externalValidationHashedBytes,
			externalValidationObjectReads: afterStage.externalValidationObjectReads,
			externalValidationSerializedBytes:
				afterStage.externalValidationSerializedBytes,
		})
		await restarted.deleteCheckpointRetentionLease(identity, `proof-local`)
		let epoch = (await restarted.checkpointHead(identity)).retentionEpoch
		await restarted.collectCheckpointGarbage({
			domain: identity,
			expectedRetentionEpoch: epoch,
		})

		const restartedAgain = restarted.restart()
		memberValue = `three`
		await append(restartedAgain, 3, [memberAddress])
		await createMosaicDomainCheckpointCoordinator({
			domain: identity,
			externalRoots: () => [externalRoot],
			readMember: () => memberValue,
			storage: restartedAgain,
		}).checkpoint()
		const third = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 4,
			domain: identity,
			previousRootKey: externalRoot,
			proposal: {
				expiresAfterRevision: 4,
				expiresAt: 100_000,
				id: `proof-after-parent-gc`,
				minimumRevision: 3,
			},
			storage: restartedAgain,
			updates: [
				{ index: `rope`, path: `node-new`, remove: true },
				{ index: `rope`, path: `node-newer`, value: { text: `third` } },
			],
		})
		expect(third.persistedObjectCount).toBeLessThan(24)
	})

	test(`restart and two partial clients hydrate only requested members plus one cut tail`, async () => {
		class ReadCountingStorage extends InMemoryMosaicDomainCheckpointStorage {
			public reads = 0

			public override readCheckpointObject(
				...args: Parameters<
					InMemoryMosaicDomainCheckpointStorage[`readCheckpointObject`]
				>
			) {
				this.reads++
				return super.readCheckpointObject(...args)
			}
		}
		const storage = new ReadCountingStorage()
		const { coordinator, values } = fixture(storage)
		const corpus = Array.from({ length: 512 }, (_, index) =>
			address(`item-${index}`),
		)
		for (const memberAddress of corpus) {
			values.set(
				mosaicDomainMemberAddressKey(memberAddress),
				String(memberAddress.key),
			)
		}
		await append(storage, 1, corpus)
		await coordinator.checkpoint()
		values.set(mosaicDomainMemberAddressKey(corpus[9]), `tail-value`)
		await append(storage, 2, [corpus[9]])

		const restarted = createMosaicDomainCheckpointCoordinator({
			domain: identity,
			readMember: ({ address: memberAddress }) =>
				values.get(mosaicDomainMemberAddressKey(memberAddress)) as string,
			storage,
		})
		storage.reads = 0
		const [left, right] = await Promise.all([
			restarted.recover([corpus[3]]),
			restarted.recover([corpus[9]]),
		])
		expect(left.members).toHaveLength(1)
		expect(right.members).toHaveLength(1)
		expect(left.headRevision).toBe(2)
		expect(right.headRevision).toBe(2)
		expect(left.tail.map(({ revision }) => revision)).toEqual([2])
		expect(right.tail.map(({ revision }) => revision)).toEqual([2])
		expect(storage.reads).toBeLessThan(20)
	})

	test(`append and retention races make stale roots retry from a fresh protected cut`, async () => {
		class RacingStorage extends InMemoryMosaicDomainCheckpointStorage {
			public race: `append` | `epoch` | null = null

			public override commitCheckpoint(
				request: MosaicDomainCheckpointCommitRequest,
			): MosaicDomainCheckpointCommitResult {
				const race = this.race
				this.race = null
				if (race === `append`) {
					const raced = address(`raced`)
					this.appendBatch({
						accepted: accepted(`batch-2`, 2, [raced]),
						expectedRevision: 1,
						fingerprint: `fingerprint-2`,
					})
				} else if (race === `epoch`) {
					this.upsertCheckpointRetentionLease(identity, {
						id: `outbox-race`,
						kind: `outbox`,
						minimumRevision: 0,
					})
				}
				return super.commitCheckpoint(request)
			}
		}
		const storage = new RacingStorage()
		const { coordinator, values } = fixture(storage)
		const original = address(`original`)
		values.set(mosaicDomainMemberAddressKey(original), `one`)
		values.set(mosaicDomainMemberAddressKey(address(`raced`)), `two`)
		await append(storage, 1, [original])
		storage.race = `append`
		const afterAppendRace = await coordinator.checkpoint()
		expect(afterAppendRace).toMatchObject({ attempts: 2, revision: 2 })

		values.set(mosaicDomainMemberAddressKey(original), `three`)
		await append(storage, 3, [original])
		storage.race = `epoch`
		const afterEpochRace = await coordinator.checkpoint()
		expect(afterEpochRace).toMatchObject({ attempts: 2, revision: 3 })
		expect((await coordinator.recover([original])).members[0]?.value).toBe(
			`three`,
		)
	})

	test(`partial staging never publishes an incomplete graph and is safely retryable`, async () => {
		class PartialStorage extends InMemoryMosaicDomainCheckpointStorage {
			public fail = true

			public override stageCheckpointObjects(
				domain: MosaicDomainIdentity,
				objects: readonly MosaicDomainCheckpointStoredObject[],
			): MosaicDomainCheckpointStageResult {
				if (!this.fail) return super.stageCheckpointObjects(domain, objects)
				this.fail = false
				super.stageCheckpointObjects(domain, objects.slice(0, 1))
				throw new Error(`simulated partial storage failure`)
			}
		}
		const storage = new PartialStorage()
		const { coordinator, values } = fixture(storage)
		const memberAddress = address(`partial`)
		values.set(mosaicDomainMemberAddressKey(memberAddress), `safe`)
		await append(storage, 1, [memberAddress])
		await expect(coordinator.checkpoint()).rejects.toThrow(
			`partial storage failure`,
		)
		expect((await storage.checkpointHead(identity)).rootKey).toBeNull()
		await expect(coordinator.recover([memberAddress])).rejects.toThrow(
			`no checkpoint`,
		)
		await expect(coordinator.checkpoint()).resolves.toMatchObject({
			revision: 1,
		})
		expect((await coordinator.recover([memberAddress])).members[0]?.value).toBe(
			`safe`,
		)
	})

	test(`publication verifies that every staged child is readable`, async () => {
		class DroppingStorage extends InMemoryMosaicDomainCheckpointStorage {
			public override stageCheckpointObjects(
				domain: MosaicDomainIdentity,
				objects: readonly MosaicDomainCheckpointStoredObject[],
			): MosaicDomainCheckpointStageResult {
				return super.stageCheckpointObjects(domain, objects.slice(1))
			}
		}
		const storage = new DroppingStorage()
		const { coordinator, values } = fixture(storage)
		const memberAddress = address(`missing-child`)
		values.set(mosaicDomainMemberAddressKey(memberAddress), `value`)
		await append(storage, 1, [memberAddress])
		await expect(coordinator.checkpoint()).rejects.toThrow(`object is missing`)
		expect((await storage.checkpointHead(identity)).rootKey).toBeNull()
	})

	test(`session, outbox, history, and proposal roots all survive reclamation`, async () => {
		const { coordinator, storage, values } = fixture()
		const memberAddress = address(`retained`)
		values.set(mosaicDomainMemberAddressKey(memberAddress), `old`)
		await append(storage, 1, [memberAddress])
		const first = await coordinator.checkpoint()
		for (const kind of [`session`, `outbox`, `history`, `proposal`] as const) {
			await storage.upsertCheckpointRetentionLease(identity, {
				id: kind,
				kind,
				minimumRevision: 0,
				rootKeys: [first.rootKey],
			})
		}
		values.set(mosaicDomainMemberAddressKey(memberAddress), `new`)
		await append(storage, 2, [memberAddress])
		await coordinator.checkpoint()
		let epoch = (await storage.checkpointHead(identity)).retentionEpoch
		await storage.collectCheckpointGarbage({
			domain: identity,
			expectedRetentionEpoch: epoch,
		})
		expect(
			await storage.readCheckpointObject(identity, first.rootKey),
		).not.toBeNull()
		for (const kind of [`session`, `outbox`, `history`] as const) {
			await storage.deleteCheckpointRetentionLease(identity, kind)
		}
		epoch = (await storage.checkpointHead(identity)).retentionEpoch
		await storage.collectCheckpointGarbage({
			domain: identity,
			expectedRetentionEpoch: epoch,
		})
		expect(
			await storage.readCheckpointObject(identity, first.rootKey),
		).not.toBeNull()
		await storage.deleteCheckpointRetentionLease(identity, `proposal`)
		epoch = (await storage.checkpointHead(identity)).retentionEpoch
		await storage.collectCheckpointGarbage({
			domain: identity,
			expectedRetentionEpoch: epoch,
		})
		expect(
			await storage.readCheckpointObject(identity, first.rootKey),
		).toBeNull()
	})

	test(`a protected root independently preserves the tail after its revision`, async () => {
		const { coordinator, storage, values } = fixture()
		const memberAddress = address(`root-tail-floor`)
		values.set(mosaicDomainMemberAddressKey(memberAddress), `old`)
		await append(storage, 1, [memberAddress])
		const first = await coordinator.checkpoint()
		values.set(mosaicDomainMemberAddressKey(memberAddress), `new`)
		await append(storage, 2, [memberAddress])
		await coordinator.checkpoint()
		await storage.upsertCheckpointRetentionLease(identity, {
			id: `old-root`,
			kind: `history`,
			minimumRevision: 2,
			rootKeys: [first.rootKey],
		})
		const epoch = (await storage.checkpointHead(identity)).retentionEpoch
		await storage.collectCheckpointGarbage({
			domain: identity,
			expectedRetentionEpoch: epoch,
		})
		expect(storage.readCheckpointTail(identity, 1, 2)).toHaveLength(1)
	})

	test(`bounded recovery fails closed instead of constructing an unbounded suffix`, async () => {
		const { coordinator, storage, values } = fixture(undefined, {
			maxRecoveryBatches: 1,
		})
		const memberAddress = address(`bounded`)
		values.set(mosaicDomainMemberAddressKey(memberAddress), 1)
		await append(storage, 1, [memberAddress])
		await coordinator.checkpoint()
		values.set(mosaicDomainMemberAddressKey(memberAddress), 3)
		await append(storage, 2, [memberAddress])
		await append(storage, 3, [memberAddress])
		await expect(coordinator.recover([memberAddress])).rejects.toThrow(
			`tail exceeds 1`,
		)
		await expect(coordinator.checkpoint()).rejects.toThrow(`tail exceeds 1`)
	})

	test(`segmented text and heterogeneous design members share the same graph`, async () => {
		const { coordinator, storage, values } = fixture()
		const Text = mosaicText({ initialText: `A👩🏽‍💻B` })
		const textAddress = address(`segment-0`, `textSegments`)
		const shapeAddress = address(`shape-7`, `shapes`)
		const layerAddress = address(`layer-2`, `layers`)
		values.set(mosaicDomainMemberAddressKey(textAddress), new Text().toJSON())
		values.set(mosaicDomainMemberAddressKey(shapeAddress), {
			fill: `#fd0`,
			x: 12,
			y: 20,
		})
		values.set(mosaicDomainMemberAddressKey(layerAddress), [
			`shape-1`,
			`shape-7`,
		])
		await append(storage, 1, [textAddress, shapeAddress, layerAddress])
		const result = await coordinator.checkpoint()
		const recovered = await coordinator.recover([
			textAddress,
			shapeAddress,
			layerAddress,
		])
		expect(result.dirtyMemberCount).toBe(3)
		expect(recovered.members.map(({ address: item }) => item.member)).toEqual([
			`textSegments`,
			`shapes`,
			`layers`,
		])
		expect(recovered.members[0]?.value).toMatchObject({ version: 2 })
		expect(recovered.members[1]?.value).toEqual({ fill: `#fd0`, x: 12, y: 20 })
	})

	test(`partial residency lazily projects a pinned checkpoint through its accepted tail`, async () => {
		const silo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `checkpoint-residency`,
		})
		const itemAtoms = silo.atomFamily<string, string>({
			default: `default`,
			key: `item`,
		})
		const model = {
			identity: { key: `checkpoint-residency-register`, version: 1 },
			kind: `value`,
			operationSchema: z.object({
				type: z.literal(`set`),
				value: z.string(),
			}),
			reduce: (_current, operation) => operation.value,
		} satisfies MosaicDomainValueModel<string, { type: `set`; value: string }>
		const definition = mosaicDomain({
			configSchema: z.object({}),
			key: `checkpoint-residency-domain`,
			members: {
				items: {
					keySchema: z.string(),
					model,
					role: `durable`,
					schema: z.string(),
					token: itemAtoms,
				},
			},
			version: 1,
		})
		const domain = await definition.activate({
			config: {},
			instance: `document`,
			store: silo.store,
		})
		const storage = new InMemoryMosaicDomainCheckpointStorage()
		const batches = createMosaicDomainBatchServer({ domain, storage })
		const memberAddress = domain.address(`items`, `a`)
		const first = await batches
			.connect({ actor: `one`, session: `one` })
			.propose({
				affectedMembers: [memberAddress],
				dependencies: [],
				domain: domain.identity,
				group: null,
				id: `residency-batch-1`,
				operations: [
					{
						address: memberAddress,
						id: `residency-operation-1`,
						model: model.identity,
						operation: { type: `set`, value: `checkpoint` },
					},
				],
				protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
				sequence: 1,
				session: `one`,
			})
		expect(first.status).toBe(`accepted`)
		const checkpoint = createMosaicDomainCheckpointCoordinator({
			domain: domain.identity,
			readMember: async ({ address: requested }) => {
				const parsed = await domain.parseAddress(requested)
				const acquired = await domain.acquire(parsed)
				return silo.getState(acquired.token)
			},
			storage,
		})
		await checkpoint.checkpoint()
		const newMemberAddress = domain.address(`items`, `b`)
		const second = {
			batch: {
				affectedMembers: [memberAddress, newMemberAddress],
				actor: `external`,
				dependencies: [`residency-batch-1`],
				domain: domain.identity,
				group: null,
				id: `residency-batch-2`,
				operations: [
					{
						address: memberAddress,
						id: `residency-operation-2`,
						model: model.identity,
						operation: { type: `set`, value: `tail` },
					},
					{
						address: newMemberAddress,
						id: `residency-operation-3`,
						model: model.identity,
						operation: { type: `set`, value: `new-from-default` },
					},
				],
				protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
				sequence: 1,
				session: `external`,
			},
			revision: 2,
		} as const
		expect(
			storage.appendBatch({
				accepted: second,
				expectedRevision: 1,
				fingerprint: `residency-fingerprint-2`,
			}).status,
		).toBe(`accepted`)
		const residency = createMosaicDomainResidencyServer({
			batches,
			checkpoint,
			domain,
		})
		const hydration = await residency
			.connect({ actor: `reader`, session: `reader` })
			.hydrate([
				{
					id: `only-a`,
					selection: {
						addresses: [memberAddress, newMemberAddress],
						kind: `members`,
					},
				},
			])
		expect(hydration).toMatchObject({
			headRevision: 2,
			members: [{ value: `tail` }, { value: `new-from-default` }],
		})
		expect(silo.getState(itemAtoms, `a`)).toBe(`checkpoint`)
		expect(silo.getState(itemAtoms, `b`)).toBe(`default`)
		residency[Symbol.dispose]()
		batches.dispose()
		domain[Symbol.dispose]()
	})

	test(`lazy member projection reduces MOS-14 transceiver checkpoints without Store acquisition`, async () => {
		const silo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `checkpoint-text-projection`,
		})
		const Text = mosaicText({ initialText: `A` })
		const textAtom = silo.mutableAtom<InstanceType<typeof Text>>({
			class: Text,
			key: `text`,
		})
		const textModel = {
			class: Text,
			kind: `transceiver`,
			operationSchema: z.custom<MosaicTextOperation>(
				(value) => typeof value === `object` && value !== null,
			),
		} satisfies MosaicDomainTransceiverModel<InstanceType<typeof Text>>
		const definition = mosaicDomain({
			configSchema: z.object({}),
			key: `checkpoint-text-domain`,
			members: {
				text: {
					model: textModel,
					role: `durable`,
					schema: z.custom<MosaicTextSnapshot>(
						(value) => typeof value === `object` && value !== null,
					),
					token: textAtom,
				},
			},
			version: 1,
		})
		const domain = await definition.activate({
			config: {},
			instance: `document`,
			store: silo.store,
		})
		const textAddress = domain.address(`text`)
		const initial = await defaultMosaicDomainMemberCheckpoint(
			domain,
			textAddress,
		)
		const author = new Text()
		const signal = author.change(
			{ text: `A👩🏽‍💻B`, type: `replace-text` },
			{
				actor: `ada`,
				dependencies: [],
				group: `typing`,
				id: `text-operation`,
				now: 1,
				revision: null,
				session: `tab`,
			},
		)!
		const tail = [
			{
				batch: {
					affectedMembers: [textAddress],
					actor: `ada`,
					dependencies: [],
					domain: domain.identity,
					group: `typing`,
					id: `text-batch`,
					operations: [
						{
							address: textAddress,
							id: signal.id,
							model: Text.mosaic,
							operation: signal.operation,
						},
					],
					protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
					sequence: 1,
					session: `tab`,
				},
				revision: 1,
			},
		] as const
		const projected = await projectMosaicDomainCheckpointMember(
			domain,
			textAddress,
			initial,
			tail,
		)
		expect(Text.fromJSON(projected as MosaicTextSnapshot).text).toBe(`A👩🏽‍💻B`)
		await expect(
			projectMosaicDomainCheckpointMember(domain, textAddress, initial, [
				{ ...tail[0], revision: 0 },
			]),
		).rejects.toThrow(`checkpoint tail is invalid`)
		await expect(
			projectMosaicDomainCheckpointMember(domain, textAddress, initial, [
				{
					...tail[0],
					batch: {
						...tail[0].batch,
						operations: tail[0].batch.operations.map((operation) => ({
							...operation,
							model: { ...operation.model, version: 99 },
						})),
					},
				},
			]),
		).rejects.toThrow(`tail model is incompatible`)
		domain[Symbol.dispose]()
	})

	test(`singleton functional defaults are invoked without a family key`, async () => {
		const silo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `checkpoint-singleton-default`,
		})
		let argumentCount = -1
		const singletonAtom = silo.atom<string>({
			default: function () {
				argumentCount = arguments.length
				return `singleton-default`
			},
			key: `singleton`,
		})
		const model = {
			identity: { key: `checkpoint-singleton-register`, version: 1 },
			kind: `value`,
			operationSchema: z.object({ type: z.literal(`set`), value: z.string() }),
			reduce: (_current, operation) => operation.value,
		} satisfies MosaicDomainValueModel<string, { type: `set`; value: string }>
		const definition = mosaicDomain({
			configSchema: z.object({}),
			key: `checkpoint-singleton-default-domain`,
			members: {
				singleton: {
					model,
					role: `durable`,
					schema: z.string(),
					token: singletonAtom,
				},
			},
			version: 1,
		})
		const domain = await definition.activate({
			config: {},
			instance: `document`,
			store: silo.store,
		})
		await expect(
			defaultMosaicDomainMemberCheckpoint(domain, domain.address(`singleton`)),
		).resolves.toBe(`singleton-default`)
		expect(argumentCount).toBe(0)
		domain[Symbol.dispose]()
	})

	test(`invalid limits, values, index paths, paging, and content keys fail closed`, async () => {
		expect(() => fixture(undefined, { maxAttempts: 0 })).toThrow(
			`maxAttempts must be a positive`,
		)
		const storage = new InMemoryMosaicDomainCheckpointStorage()
		expect(() => storage.listCheckpointObjects(identity, { limit: 0 })).toThrow(
			`between 1 and 1024`,
		)
		expect(() => storage.openCheckpointRead(identity, ``)).toThrow(
			`lease ID is invalid`,
		)
		const badValue = createMosaicDomainCheckpointCoordinator({
			domain: identity,
			readMember: () => undefined as never,
			storage,
		})
		await append(storage, 1, [address(`bad`)])
		await expect(badValue.checkpoint()).rejects.toThrow(`JSON-serializable`)

		const object = {
			depth: 0,
			entries: [],
			kind: `directory-leaf`,
		} as const
		const contentKey = mosaicDomainCheckpointObjectKey(object)
		await storage.stageCheckpointObjects(identity, [
			{
				key: contentKey,
				value: object,
			},
		])
		expect(
			storage.stageCheckpointObjects(identity, [
				{ key: contentKey, value: object },
			]),
		).toEqual({ persistedBytes: 0, persistedObjectCount: 0 })
		expect(() =>
			storage.stageCheckpointObjects(identity, [
				{ key: `sha256:${`a`.repeat(64)}`, value: object },
			]),
		).toThrow(`content key is invalid`)
		expect(() =>
			storage.stageCheckpointObjects(identity, [
				{
					key: `sha256:${`b`.repeat(64)}`,
					value: {
						...object,
						entries: [{ key: `invalid`, value: undefined }],
					} as never,
				},
			]),
		).toThrow(`checkpoint object is invalid`)
	})

	test(`storage rejects malformed lifecycle boundaries and retained-horizon reads`, async () => {
		const storage = new InMemoryMosaicDomainCheckpointStorage()
		expect(() =>
			storage.upsertCheckpointRetentionLease(identity, {
				id: ``,
				kind: `session`,
				minimumRevision: 0,
			}),
		).toThrow(`retention lease is invalid`)
		expect(() =>
			storage.upsertCheckpointRetentionLease(identity, {
				id: `missing-root`,
				kind: `history`,
				minimumRevision: 0,
				rootKeys: [`sha256:${`c`.repeat(64)}`],
			}),
		).toThrow(`retention root is invalid`)
		expect(() =>
			storage.stageCheckpointObjects(identity, null as never),
		).toThrow(`must be an array`)
		expect(() =>
			storage.stageCheckpointObjects(identity, [
				{ key: `invalid` as never, value: undefined as never },
			]),
		).toThrow(`checkpoint object is invalid`)
		expect(() =>
			storage.appendBatch({
				accepted: accepted(`wrong-revision`, 2, [address(`a`)]),
				expectedRevision: 0,
				fingerprint: `wrong`,
			}),
		).toThrow(`append must use revision 1`)
		expect(() => storage.readCheckpointTail(identity, -1, 0)).toThrow(
			`tail range is invalid`,
		)
		expect(() => storage.readCheckpointTail(identity, 0, 1)).toThrow(
			`moved beyond its head`,
		)

		const { coordinator, values } = fixture(storage)
		const members = Array.from({ length: 32 }, (_, index) =>
			address(`gc-${index}`),
		)
		for (const memberAddress of members) {
			values.set(mosaicDomainMemberAddressKey(memberAddress), `value`)
		}
		await append(storage, 1, members)
		await coordinator.checkpoint()
		const epoch = (await storage.checkpointHead(identity)).retentionEpoch
		await storage.collectCheckpointGarbage({
			domain: identity,
			expectedRetentionEpoch: epoch,
		})
		expect(() => storage.readCheckpointTail(identity, 0, 1)).toThrow(
			`no retained tail`,
		)
		expect(() => storage.recover(identity, -1)).toThrow(`non-negative`)
		expect(() => storage.recover(identity, 0)).toThrow(`no retained tail`)
		storage.openCheckpointRead(identity, `duplicate-read`)
		expect(() => storage.openCheckpointRead(identity, `duplicate-read`)).toThrow(
			`already exists`,
		)
		storage.deleteCheckpointRetentionLease(identity, `duplicate-read`)
		expect(storage.deleteCheckpointRetentionLease(identity, `missing`)).toBe(
			(await storage.checkpointHead(identity)).retentionEpoch,
		)
		const lease = {
			id: `same`,
			kind: `outbox` as const,
			minimumRevision: 1,
		}
		const firstEpoch = storage.upsertCheckpointRetentionLease(identity, lease)
		expect(storage.upsertCheckpointRetentionLease(identity, lease)).toBe(
			firstEpoch,
		)
		expect(
			storage.listCheckpointObjects(identity, {
				after: `sha256:${`f`.repeat(64)}`,
			}),
		).toEqual({ cursor: null, objects: [] })
	})

	test(`external graph builders reject malformed bounds and proposal transitions`, async () => {
		expect(
			() => new InMemoryMosaicDomainCheckpointStorage({ maxRecentReceipts: 0 }),
		).toThrow(`maxRecentReceipts must be a positive`)
		expect(
			() =>
				new InMemoryMosaicDomainCheckpointStorage({ maxSessionWatermarks: 0 }),
		).toThrow(`maxSessionWatermarks must be a positive`)

		const storage = new InMemoryMosaicDomainCheckpointStorage({ now: () => 100 })
		await expect(
			stageMosaicDomainExternalCheckpointGraph({
				baseRevision: 0,
				domain: identity,
				limits: { maxBytes: 0 },
				storage,
				updates: [{ index: `rope`, path: `root`, value: `value` }],
			}),
		).rejects.toThrow(`maxBytes must be a positive`)
		await expect(
			stageMosaicDomainExternalCheckpointGraph({
				baseRevision: -1,
				domain: identity,
				storage,
				updates: [],
			}),
		).rejects.toThrow(`base revision is invalid`)
		await expect(
			stageMosaicDomainExternalCheckpointGraph({
				baseRevision: 0,
				domain: identity,
				limits: { maxUpdates: 1 },
				storage,
				updates: [
					{ index: `rope`, path: `a`, value: `a` },
					{ index: `rope`, path: `b`, value: `b` },
				],
			}),
		).rejects.toThrow(`updates exceed 1`)
		await expect(
			stageMosaicDomainExternalCheckpointGraph({
				baseRevision: 0,
				domain: identity,
				storage,
				updates: [],
			}),
		).rejects.toThrow(`graph is empty`)
		await expect(
			stageMosaicDomainExternalCheckpointGraph({
				baseRevision: 0,
				domain: identity,
				storage,
				updates: [
					{ index: `rope`, path: `same`, value: `one` },
					{ index: `rope`, path: `same`, value: `two` },
				],
			}),
		).rejects.toThrow(`update is invalid`)
		await expect(
			stageMosaicDomainExternalCheckpointGraph({
				baseRevision: 0,
				domain: identity,
				limits: { maxBytes: 4 },
				storage,
				updates: [{ index: `rope`, path: `root`, value: `too large` }],
			}),
		).rejects.toThrow(`graph exceeds 4 bytes`)
		await expect(
			stageMosaicDomainExternalCheckpointGraph({
				baseRevision: 0,
				domain: identity,
				previousRootKey: `invalid` as never,
				storage,
				updates: [],
			}),
		).rejects.toThrow(`object key is invalid`)
		await expect(
			stageMosaicDomainExternalCheckpointGraph({
				baseRevision: 0,
				domain: identity,
				previousRootKey: `sha256:${`0`.repeat(64)}`,
				storage,
				updates: [],
			}),
		).rejects.toThrow(`is missing`)

		const emptyRemoval = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 0,
			domain: identity,
			storage,
			updates: [{ index: `rope`, path: `absent`, remove: true }],
		})
		expect(emptyRemoval.bytes).toBe(0)

		const staged = (value: MosaicDomainCheckpointObject) => ({
			key: mosaicDomainCheckpointObjectKey(value),
			value,
		})
		const leaf = staged({ depth: 0, entries: [], kind: `directory-leaf` })
		expect(() =>
			storage.stageCheckpointObjects(identity, [leaf], {
				proposal: {
					expiresAfterRevision: 1,
					expiresAt: 1_000,
					id: `unpaired`,
					minimumRevision: 0,
					rootKey: leaf.key,
				},
			}),
		).toThrow(`requires one atomic proposal`)
		expect(() =>
			storage.stageCheckpointObjects(identity, [leaf], {
				externalGraph: { rootKey: leaf.key, updates: [] },
				proposal: {
					expiresAfterRevision: 1,
					expiresAt: 1_000,
					id: `wrong-root-kind`,
					minimumRevision: 0,
					rootKey: leaf.key,
				},
			}),
		).toThrow(`proposal root is invalid`)
		expect(() =>
			storage.appendBatch({
				accepted: accepted(`invalid-proposal-list`, 1, [address(`bad-list`)]),
				checkpointProposals: null as never,
				expectedRevision: 0,
				fingerprint: `invalid-proposal-list`,
			}),
		).toThrow(`proposal list is invalid`)

		const collision = (value: string, expiresAt: number) =>
			stageMosaicDomainExternalCheckpointGraph({
				baseRevision: 1,
				domain: identity,
				proposal: {
					expiresAfterRevision: 1,
					expiresAt,
					id: `stable-proposal-id`,
					minimumRevision: 0,
				},
				storage,
				updates: [{ index: `rope`, path: `root`, value }],
			})
		await collision(`first`, 1_000)
		await expect(collision(`different`, 1_000)).rejects.toThrow(
			`proposal identity collided`,
		)
		await expect(collision(`first`, 900)).rejects.toThrow(`cannot shorten`)
	})

	test(`legacy external graphs are fully verified and paged reads fail closed`, async () => {
		const storage = new InMemoryMosaicDomainCheckpointStorage()
		const logicalKey = JSON.stringify([`rope`, `root`])
		const index = {
			index: `different-index`,
			kind: `index`,
			path: `different-path`,
			revision: 1,
			value: `legacy-value`,
		} as const
		const indexKey = mosaicDomainCheckpointObjectKey(index)
		const directory = {
			depth: 0,
			entries: [{ key: logicalKey, value: indexKey }],
			kind: `directory-leaf`,
		} as const
		const directoryKey = mosaicDomainCheckpointObjectKey(directory)
		const external = {
			baseRevision: 1,
			bytes: new TextEncoder().encode(JSON.stringify(index.value)).byteLength,
			depth: 0,
			directory: directoryKey,
			domain: identity,
			kind: `external-root`,
		} as const
		const externalKey = mosaicDomainCheckpointObjectKey(external)
		await storage.stageCheckpointObjects(identity, [
			{ key: indexKey, value: index },
			{ key: directoryKey, value: directory },
			{ key: externalKey, value: external },
		])
		await append(storage, 1, [address(`legacy`)])
		await createMosaicDomainCheckpointCoordinator({
			domain: identity,
			externalRoots: () => [externalKey],
			readMember: () => `legacy`,
			storage,
		}).checkpoint()

		const reader = createMosaicDomainCheckpointCoordinator({
			domain: identity,
			readMember: () => `legacy`,
			storage,
		})
		await expect(
			reader.readExternalIndexes(externalKey, [
				{ index: `rope`, path: `absent` },
				{ index: `rope`, path: `absent` },
			]),
		).rejects.toThrow(`index address is invalid`)
		await expect(
			reader.readExternalIndexes(externalKey, [{ index: `rope`, path: `root` }]),
		).rejects.toThrow(`external checkpoint index is invalid`)

		const unpublished = {
			...external,
			bytes: 0,
			directory: null,
		} as const
		const unpublishedKey = mosaicDomainCheckpointObjectKey(unpublished)
		await storage.stageCheckpointObjects(identity, [
			{ key: unpublishedKey, value: unpublished },
		])
		await expect(reader.readExternalIndexes(unpublishedKey, [])).rejects.toThrow(
			`root is not published`,
		)
		await expect(
			createMosaicDomainCheckpointCoordinator({
				domain: { ...identity, instance: `without-checkpoint` },
				readMember: () => null,
				storage,
			}).readExternalIndexes(externalKey, []),
		).rejects.toThrow(`has no checkpoint`)

		const firstPage = await storage.listCheckpointObjects(identity, { limit: 1 })
		expect(firstPage.objects).toHaveLength(1)
		expect(firstPage.cursor).not.toBeNull()
		expect(
			await storage.listCheckpointObjects(identity, {
				after: firstPage.cursor!,
				limit: 1,
			}),
		).toMatchObject({ objects: [{ key: expect.any(String) }] })

		const foreignRoot = {
			domain: { ...identity, instance: `foreign` },
			externalRoots: [],
			indexDirectory: null,
			kind: `root`,
			memberDirectory: null,
			protocolVersion: 1,
			retentionEpoch: 1,
			revision: 0,
		} as const
		const foreignRootKey = mosaicDomainCheckpointObjectKey(foreignRoot)
		await storage.stageCheckpointObjects(identity, [
			{ key: foreignRootKey, value: foreignRoot },
		])
		expect(() =>
			storage.upsertCheckpointRetentionLease(identity, {
				id: `foreign-root`,
				kind: `history`,
				minimumRevision: 0,
				rootKeys: [foreignRootKey],
			}),
		).toThrow(`retention root is invalid`)
		expect(() =>
			storage.upsertCheckpointRetentionLease(identity, {
				id: `external-root`,
				kind: `history`,
				minimumRevision: 0,
				rootKeys: [unpublishedKey],
			}),
		).toThrow(`must be protected by atomic staging`)
		expect(() =>
			storage.upsertCheckpointRetentionLease(identity, {
				id: `index-root`,
				kind: `history`,
				minimumRevision: 0,
				rootKeys: [indexKey],
			}),
		).toThrow(`retention root is invalid`)

		const brokenRoot = {
			domain: identity,
			externalRoots: [],
			indexDirectory: null,
			kind: `root`,
			memberDirectory: `sha256:${`d`.repeat(64)}`,
			protocolVersion: 1,
			retentionEpoch: 1,
			revision: 0,
		} as const
		const brokenRootKey = mosaicDomainCheckpointObjectKey(brokenRoot)
		await storage.stageCheckpointObjects(identity, [
			{ key: brokenRootKey, value: brokenRoot },
		])
		await storage.upsertCheckpointRetentionLease(identity, {
			id: `broken-root`,
			kind: `history`,
			minimumRevision: 0,
			rootKeys: [brokenRootKey],
		})
		const brokenEpoch = (await storage.checkpointHead(identity)).retentionEpoch
		expect(() =>
			storage.collectCheckpointGarbage({
				domain: identity,
				expectedRetentionEpoch: brokenEpoch,
			}),
		).toThrow(`checkpoint object is missing`)
	})

	test(`legacy commit validation rejects malformed authenticated subgraphs`, async () => {
		const commitLegacy = async (options: {
			readonly bytes?: number
			readonly directory: MosaicDomainCheckpointObject
			readonly directoryKey?: `sha256:${string}`
			readonly externalDepth?: number
			readonly extra?: readonly MosaicDomainCheckpointObject[]
		}) => {
			const storage = new InMemoryMosaicDomainCheckpointStorage()
			await append(storage, 1, [address(`legacy-malformed`)])
			const objects = [...(options.extra ?? []), options.directory]
			const stored = objects.map((value) => ({
				key: mosaicDomainCheckpointObjectKey(value),
				value,
			}))
			const directoryKey =
				options.directoryKey ??
				mosaicDomainCheckpointObjectKey(options.directory)
			const external = {
				baseRevision: 1,
				bytes: options.bytes ?? 0,
				depth: options.externalDepth ?? 0,
				directory: directoryKey,
				domain: identity,
				kind: `external-root`,
			} as const
			const externalKey = mosaicDomainCheckpointObjectKey(external)
			const root = {
				domain: identity,
				externalRoots: [externalKey],
				indexDirectory: null,
				kind: `root`,
				memberDirectory: null,
				protocolVersion: 1,
				retentionEpoch: 1,
				revision: 1,
			} as const
			const rootKey = mosaicDomainCheckpointObjectKey(root)
			await storage.stageCheckpointObjects(identity, [
				...stored,
				{ key: externalKey, value: external },
				{ key: rootKey, value: root },
			])
			return () =>
				storage.commitCheckpoint({
					domain: identity,
					expectedRetentionEpoch: 0,
					expectedRevision: 1,
					expectedRootKey: null,
					rootKey,
				})
		}

		const deepLeaf = {
			depth: 1,
			entries: [],
			kind: `directory-leaf`,
		} as const
		expect(await commitLegacy({ directory: deepLeaf })).toThrow(
			`external checkpoint depth is invalid`,
		)

		const futureIndex = {
			index: `rope`,
			kind: `index`,
			path: `future`,
			revision: 2,
			value: `future`,
		} as const
		expect(
			await commitLegacy({
				bytes: new TextEncoder().encode(JSON.stringify(futureIndex.value))
					.byteLength,
				directory: futureIndex,
			}),
		).toThrow(`external checkpoint index is invalid`)

		const currentIndex = { ...futureIndex, revision: 1 }
		expect(await commitLegacy({ bytes: 0, directory: currentIndex })).toThrow(
			`external checkpoint graph is invalid`,
		)

		const member = {
			address: address(`not-a-directory`),
			kind: `member`,
			revision: 1,
			value: null,
		} as const
		expect(await commitLegacy({ directory: member })).toThrow(
			`external checkpoint graph is invalid`,
		)

		const missing = `sha256:${`e`.repeat(64)}` as const
		const missingLeaf = {
			depth: 0,
			entries: [{ key: `missing`, value: missing }],
			kind: `directory-leaf`,
		} as const
		expect(await commitLegacy({ directory: missingLeaf })).toThrow(
			`checkpoint object is missing`,
		)

		const invalidDirectory = {
			depth: -1,
			entries: [],
			kind: `directory-leaf`,
		} as const
		expect(await commitLegacy({ directory: invalidDirectory })).toThrow(
			`checkpoint directory is invalid`,
		)
	})

	test(`external-root selection validates hook, recovery, and accepted-head bounds`, async () => {
		expect(() => fixture(undefined, { maxExternalDepth: -1 })).toThrow(
			`maxExternalDepth must be a non-negative`,
		)
		const invalidHookStorage = new InMemoryMosaicDomainCheckpointStorage()
		await expect(
			createMosaicDomainCheckpointCoordinator({
				domain: identity,
				externalRoots: () => null as never,
				readMember: () => null,
				storage: invalidHookStorage,
			}).checkpoint(),
		).rejects.toThrow(`roots exceed 64`)
		const fake = `sha256:${`1`.repeat(64)}` as const
		await expect(
			createMosaicDomainCheckpointCoordinator({
				domain: identity,
				externalRoots: () => [fake, fake],
				readMember: () => null,
				storage: invalidHookStorage,
			}).checkpoint(),
		).rejects.toThrow(`root key is invalid`)

		class AcceptedHeadStorage extends InMemoryMosaicDomainCheckpointStorage {
			public accepted: unknown = []

			public override openCheckpointRead(
				...args: Parameters<
					InMemoryMosaicDomainCheckpointStorage[`openCheckpointRead`]
				>
			) {
				return {
					...super.openCheckpointRead(...args),
					acceptedRootKeys: this.accepted as never,
				}
			}
		}
		const acceptedHead = new AcceptedHeadStorage()
		const acceptedCoordinator = createMosaicDomainCheckpointCoordinator({
			domain: identity,
			readMember: () => null,
			storage: acceptedHead,
		})
		acceptedHead.accepted = {}
		await expect(acceptedCoordinator.checkpoint()).rejects.toThrow(
			`accepted external checkpoint root list is invalid`,
		)
		acceptedHead.accepted = [`invalid`]
		await expect(acceptedCoordinator.checkpoint()).rejects.toThrow(
			`accepted external checkpoint root key is invalid`,
		)
		acceptedHead.accepted = Array.from(
			{ length: 65 },
			(_, index) => `sha256:${index.toString(16).padStart(64, `0`)}` as const,
		)
		await expect(acceptedCoordinator.checkpoint()).rejects.toThrow(
			`roots exceed 64`,
		)

		const storage = new InMemoryMosaicDomainCheckpointStorage()
		const left = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 1,
			domain: identity,
			storage,
			updates: [{ index: `left`, path: `root`, value: `aaaa` }],
		})
		const right = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 1,
			domain: identity,
			storage,
			updates: [{ index: `right`, path: `root`, value: `bbbb` }],
		})
		await append(storage, 1, [address(`aggregate-external`)])
		await createMosaicDomainCheckpointCoordinator({
			domain: identity,
			externalRoots: () => [left.rootKey, right.rootKey],
			readMember: () => `aggregate`,
			storage,
		}).checkpoint()
		await expect(
			createMosaicDomainCheckpointCoordinator({
				domain: identity,
				limits: { maxExternalBytes: left.bytes + right.bytes - 1 },
				readMember: () => `aggregate`,
				storage,
			}).recover([]),
		).rejects.toThrow(`roots exceed`)

		const unpublishedStorage = new InMemoryMosaicDomainCheckpointStorage()
		const stagedLeft = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 1,
			domain: identity,
			storage: unpublishedStorage,
			updates: [{ index: `left`, path: `root`, value: `aaaa` }],
		})
		const stagedRight = await stageMosaicDomainExternalCheckpointGraph({
			baseRevision: 1,
			domain: identity,
			storage: unpublishedStorage,
			updates: [{ index: `right`, path: `root`, value: `bbbb` }],
		})
		await append(unpublishedStorage, 1, [address(`bounded-external`)])
		await expect(
			createMosaicDomainCheckpointCoordinator({
				domain: identity,
				externalRoots: () => [stagedLeft.rootKey, stagedRight.rootKey],
				limits: {
					maxExternalBytes: stagedLeft.bytes + stagedRight.bytes - 1,
				},
				readMember: () => `bounded`,
				storage: unpublishedStorage,
			}).checkpoint(),
		).rejects.toThrow(`roots exceed`)
	})

	test(`coordinator bounds and malformed read requests fail before publication`, async () => {
		const { coordinator, storage, values } = fixture()
		const one = address(`one`)
		values.set(mosaicDomainMemberAddressKey(one), `one`)
		await append(storage, 1, [one])
		await coordinator.checkpoint()
		await expect(coordinator.checkpoint()).resolves.toMatchObject({
			status: `unchanged`,
		})
		await expect(coordinator.recover([one, one])).rejects.toThrow(
			`must be unique`,
		)
		await expect(coordinator.recover(null as never)).rejects.toThrow(
			`recovery members are invalid`,
		)
		await expect(
			coordinator.recover([address(`absent`)]),
		).resolves.toMatchObject({
			members: [],
		})
		await expect(coordinator.readIndex(`by-key`, `absent`)).resolves.toBeNull()
		await expect(coordinator.readIndex(``, `absent`)).rejects.toThrow(
			`index address is invalid`,
		)
		await expect(
			createMosaicDomainCheckpointCoordinator({
				domain: { ...identity, instance: `empty-index` },
				readMember: () => null,
				storage,
			}).readIndex(`index`, `path`),
		).resolves.toBeNull()
		const emptyDomain = { ...identity, instance: `empty-directory` }
		const emptyCoordinator = createMosaicDomainCheckpointCoordinator({
			domain: emptyDomain,
			readMember: () => null,
			storage,
		})
		await emptyCoordinator.checkpoint()
		await expect(
			emptyCoordinator.recover([
				{ domain: emptyDomain, key: `absent`, member: `items` },
			]),
		).resolves.toMatchObject({ members: [] })

		const dirtyLimited = fixture(undefined, { maxDirtyMembers: 1 })
		const two = [address(`two-a`), address(`two-b`)]
		for (const memberAddress of two) {
			dirtyLimited.values.set(
				mosaicDomainMemberAddressKey(memberAddress),
				`value`,
			)
		}
		await append(dirtyLimited.storage, 1, two)
		await expect(dirtyLimited.coordinator.checkpoint()).rejects.toThrow(
			`dirty checkpoint members exceed 1`,
		)

		const indexLimited = fixture(undefined, { maxDirtyIndexPaths: 1 })
		for (const memberAddress of two) {
			indexLimited.values.set(
				mosaicDomainMemberAddressKey(memberAddress),
				`value`,
			)
		}
		await append(indexLimited.storage, 1, two)
		await expect(indexLimited.coordinator.checkpoint()).rejects.toThrow(
			`index paths exceed 1`,
		)
		const invalidIndexStorage = new InMemoryMosaicDomainCheckpointStorage()
		await append(invalidIndexStorage, 1, [one])
		const invalidIndex = createMosaicDomainCheckpointCoordinator({
			domain: identity,
			indexes: () => [{ index: ``, path: `path`, value: null }],
			readMember: () => `value`,
			storage: invalidIndexStorage,
		})
		await expect(invalidIndex.checkpoint()).rejects.toThrow(
			`index update is invalid`,
		)

		const tooLarge = fixture(undefined, { maxObjectBytes: 32 })
		tooLarge.values.set(mosaicDomainMemberAddressKey(one), `x`.repeat(100))
		await append(tooLarge.storage, 1, [one])
		await expect(tooLarge.coordinator.checkpoint()).rejects.toThrow(
			`object exceeds 32 bytes`,
		)

		const classValue = fixture()
		classValue.values.set(mosaicDomainMemberAddressKey(one), new Date())
		await append(classValue.storage, 1, [one])
		await expect(classValue.coordinator.checkpoint()).rejects.toThrow(
			`JSON-serializable`,
		)

		class AlwaysStaleStorage extends InMemoryMosaicDomainCheckpointStorage {
			public override commitCheckpoint(
				request: MosaicDomainCheckpointCommitRequest,
			): MosaicDomainCheckpointCommitResult {
				return {
					actualRevision: request.expectedRevision,
					retentionEpoch: request.expectedRetentionEpoch,
					rootKey: request.expectedRootKey,
					status: `stale`,
				}
			}
		}
		const stale = fixture(new AlwaysStaleStorage(), { maxAttempts: 2 })
		stale.values.set(mosaicDomainMemberAddressKey(one), `value`)
		await append(stale.storage, 1, [one])
		await expect(stale.coordinator.checkpoint()).rejects.toThrow(
			`could not stabilize after 2 attempts`,
		)
	})
})
