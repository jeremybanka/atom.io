import { Silo } from "atom.io"
import {
	defaultMosaicDomainMemberCheckpoint,
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
	type MosaicAcceptedDomainBatchEnvelope,
	mosaicDomain,
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
