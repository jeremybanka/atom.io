import { Silo } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import {
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
	type MosaicAcceptedDomainBatchEnvelope,
	mosaicDomain,
	type MosaicDomainBatchProposal,
	type MosaicDomainHistoryCursor,
	type MosaicDomainMemberAddress,
	mosaicDomainMemberModelIdentity,
	type MosaicDomainValueModel,
	mosaicText,
	type MosaicTextOperation,
} from "atom.io/realtime"
import { createMosaicDomainResidencyClient } from "atom.io/realtime-client"
import {
	createMosaicDomainBatchServer,
	createMosaicDomainCheckpointCoordinator,
	createMosaicDomainHistoryCoordinator,
	createMosaicDomainResidencyServer,
	InMemoryMosaicDomainCheckpointStorage,
	type MosaicDomainBatchServer,
	type MosaicDomainHistoryCoordinatorOptions,
} from "atom.io/realtime-server"
import {
	generateModelScenario,
	runModelScenario,
} from "atom.io/realtime-testing"
import { z } from "zod"

type CounterOperation =
	| { readonly amount: number; readonly type: `add` }
	| {
			readonly mode: `redo` | `undo`
			readonly targetOperationIds: readonly string[]
			readonly type: `history`
	  }
	| { readonly type: `maintenance` }

type CounterChange = {
	readonly active: boolean
	readonly actor: string
	readonly amount: number
}

type CounterState = {
	readonly baseline: number
	readonly changes: Readonly<Record<string, CounterChange>>
}

type CounterModel = MosaicDomainValueModel<
	CounterState & Json.Serializable,
	CounterOperation & Json.Serializable
>

type CounterCompensate = NonNullable<CounterModel[`history`]>[`compensate`]

const counterCompensationOverrides = new Map<string, CounterCompensate>()

const counterOperationSchema: z.ZodType<CounterOperation> = z.discriminatedUnion(
	`type`,
	[
		z.object({ amount: z.number().finite(), type: z.literal(`add`) }).strict(),
		z
			.object({
				mode: z.enum([`redo`, `undo`]),
				targetOperationIds: z.array(z.string().min(1)).min(1),
				type: z.literal(`history`),
			})
			.strict(),
		z.object({ type: z.literal(`maintenance`) }).strict(),
	],
)

const counterStateSchema: z.ZodType<CounterState> = z
	.object({
		baseline: z.number().finite(),
		changes: z.record(
			z.string(),
			z
				.object({
					active: z.boolean(),
					actor: z.string().min(1),
					amount: z.number().finite(),
				})
				.strict(),
		),
	})
	.strict()

const counterModel = (key: string): CounterModel => ({
	history: {
		classify(operation) {
			if (operation.type === `maintenance`) return { kind: `exclude` }
			return operation.type === `add`
				? { kind: `change` }
				: {
						kind: `compensation`,
						mode: operation.mode,
						targetOperationIds: operation.targetOperationIds,
					}
		},
		compact(value, { retainedOperationIds }) {
			let baseline = value.baseline
			const changes: Record<string, CounterChange> = {}
			for (const [id, change] of Object.entries(value.changes)) {
				if (retainedOperationIds.has(id)) changes[id] = change
				else if (change.active) baseline += change.amount
			}
			return { baseline, changes }
		},
		compensate(context) {
			const override = counterCompensationOverrides.get(key)
			if (override !== undefined) return override(context)
			const { mode, targets } = context
			return {
				mode,
				targetOperationIds: targets.map(({ id }) => id),
				type: `history`,
			}
		},
		references(value) {
			return value.baseline === -999 ? [`model-reference`] : []
		},
	},
	identity: { key, version: 1 },
	kind: `value`,
	operationSchema: counterOperationSchema,
	reduce(value, operation, context) {
		if (operation.type === `maintenance`) return value
		const changes = { ...value.changes }
		if (operation.type === `add`) {
			const existing = changes[context.id]
			if (existing !== undefined) {
				if (
					existing.actor !== context.actor ||
					existing.amount !== operation.amount
				) {
					throw new Error(`Counter operation ID collision`)
				}
				return value
			}
			changes[context.id] = {
				active: true,
				actor: context.actor,
				amount: operation.amount,
			}
			return { baseline: value.baseline, changes }
		}
		for (const target of operation.targetOperationIds) {
			const change = changes[target]
			if (change?.actor !== context.actor) {
				throw new Error(
					`Counter history can target only the authenticated actor`,
				)
			}
			changes[target] = { ...change, active: operation.mode === `redo` }
		}
		return { baseline: value.baseline, changes }
	},
})

const leftModel = counterModel(`history-left`)
const segmentModel = counterModel(`history-segment`)
const historyFreeModel: CounterModel = {
	identity: { key: `history-free`, version: 1 },
	kind: `value`,
	operationSchema: counterOperationSchema,
	reduce: leftModel.reduce,
}
const EMPTY_COUNTER: CounterState = { baseline: 0, changes: {} }

async function fixture(
	storage = new InMemoryMosaicDomainCheckpointStorage(),
	name = `history-fixture`,
	completeCompensation?: MosaicDomainHistoryCoordinatorOptions<any>[`completeCompensation`],
) {
	const silo = new Silo({ isProduction: false, lifespan: `ephemeral`, name })
	const leftAtom = silo.atom<CounterState>({
		default: EMPTY_COUNTER,
		key: `left`,
	})
	const segmentAtoms = silo.atomFamily<CounterState, string>({
		default: EMPTY_COUNTER,
		key: `segment`,
	})
	const historyFreeAtom = silo.atom<CounterState>({
		default: EMPTY_COUNTER,
		key: `historyFree`,
	})
	const unmodeledAtom = silo.atom<CounterState>({
		default: EMPTY_COUNTER,
		key: `unmodeled`,
	})
	const definition = mosaicDomain({
		configSchema: z.object({}).strict(),
		key: `history-domain`,
		members: {
			historyFree: {
				model: historyFreeModel,
				role: `durable`,
				schema: counterStateSchema,
				token: historyFreeAtom,
			},
			left: {
				model: leftModel,
				role: `durable`,
				schema: counterStateSchema,
				token: leftAtom,
			},
			segments: {
				keySchema: z.string().min(1),
				model: segmentModel,
				role: `durable`,
				schema: counterStateSchema,
				token: segmentAtoms,
			},
			unmodeled: {
				role: `durable`,
				schema: counterStateSchema,
				token: unmodeledAtom,
			},
		},
		version: 1,
	})
	const domain = await definition.activate({
		config: {},
		instance: `document`,
		store: silo.store,
	})
	const batches = createMosaicDomainBatchServer({ domain, storage })
	const history = createMosaicDomainHistoryCoordinator({
		batches,
		...(completeCompensation === undefined ? {} : { completeCompensation }),
		domain,
		limits: { maxCheckpointRaceSnapshots: 3, undoStepsPerActor: 3 },
		storage,
	})
	return {
		batches,
		domain,
		history,
		left: leftAtom,
		segments: segmentAtoms,
		silo,
		storage,
	}
}

const counterValue = (state: CounterState): number =>
	state.baseline +
	Object.values(state.changes).reduce(
		(total, change) => total + (change.active ? change.amount : 0),
		0,
	)

const acceptedEnvelope = (
	domain: Awaited<ReturnType<typeof fixture>>[`domain`],
	address: MosaicDomainMemberAddress,
	revision: number,
	operations: readonly CounterOperation[],
	group: string | null = `recovery-group-${revision}`,
): MosaicAcceptedDomainBatchEnvelope => ({
	batch: {
		affectedMembers: [address],
		actor: `alice`,
		dependencies: revision === 1 ? [] : [`recovery-${revision - 1}`],
		domain: domain.identity,
		group,
		id: `recovery-${revision}`,
		operations: operations.map((operation, index) => ({
			address,
			id: `recovery-operation-${revision}-${index}`,
			model: mosaicDomainMemberModelIdentity(leftModel),
			operation,
		})),
		protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
		sequence: revision,
		session: `recovery`,
	},
	revision,
})

const recoveringBatchServer = (
	headRevision: number,
	tail: readonly MosaicAcceptedDomainBatchEnvelope[],
): MosaicDomainBatchServer => ({
	connect() {
		return {
			propose() {
				throw new Error(`Recovery fixture cannot propose`)
			},
			recover() {
				return Promise.resolve({ headRevision, tail })
			},
			subscribe() {
				return () => undefined
			},
		}
	},
	dispose() {},
	revision: headRevision,
})

describe(`Mosaic Domain actor-selective history`, () => {
	test(`completes compensation with atomic history-free maintenance`, async () => {
		let maintenanceAddress: MosaicDomainMemberAddress | undefined
		const setup = await fixture(
			undefined,
			`history-completion`,
			({ operations }) => {
				expect(operations).toHaveLength(1)
				expect(operations[0].operation).toMatchObject({
					mode: `undo`,
					type: `history`,
				})
				return [
					{
						address: maintenanceAddress!,
						operation: { type: `maintenance` },
					},
				]
			},
		)
		const leftAddress = setup.domain.address(`left`)
		maintenanceAddress = setup.domain.address(`segments`, `index-root`)
		const connection = setup.batches.connect({
			actor: `alice`,
			session: `alice-editor`,
		})
		const observed: MosaicAcceptedDomainBatchEnvelope[] = []
		const stop = connection.subscribe((accepted) => observed.push(accepted))
		const edited = await connection.propose({
			affectedMembers: [leftAddress],
			dependencies: [],
			domain: setup.domain.identity,
			group: `typing`,
			id: `edit`,
			operations: [
				{
					address: leftAddress,
					id: `edit:0`,
					model: mosaicDomainMemberModelIdentity(leftModel),
					operation: { amount: 1, type: `add` },
				},
			],
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: 1,
			session: `alice-editor`,
		})
		expect(edited.status).toBe(`accepted`)
		await setup.history.flush()
		const history = setup.history.connect({
			actor: `alice`,
			session: `alice-history`,
		})
		const snapshot = await history.snapshot()
		const undone = await history.request({
			cursor: snapshot.cursor,
			id: `undo`,
			mode: `undo`,
			sequence: 1,
			session: `alice-history`,
		})
		expect(undone).toMatchObject({ acceptedRevision: 2, status: `accepted` })
		expect(observed.at(-1)?.batch.operations).toHaveLength(2)
		expect(observed.at(-1)?.batch.operations[1]).toMatchObject({
			address: maintenanceAddress,
			operation: { type: `maintenance` },
		})
		expect(counterValue(setup.silo.getState(setup.left))).toBe(0)
		stop()
		history[Symbol.dispose]()
		setup.history[Symbol.dispose]()
		setup.batches.dispose()
		setup.domain[Symbol.dispose]()
	})

	test(`rejects compensation completion that is unmodeled or enters history`, async () => {
		for (const invalid of [`change`, `unmodeled`] as const) {
			let completionAddress: MosaicDomainMemberAddress | undefined
			const setup = await fixture(
				undefined,
				`invalid-history-completion-${invalid}`,
				() => [
					{
						address: completionAddress!,
						operation:
							invalid === `change`
								? { amount: 1, type: `add` }
								: { type: `maintenance` },
					},
				],
			)
			completionAddress = setup.domain.address(
				invalid === `change` ? `left` : `unmodeled`,
			)
			const leftAddress = setup.domain.address(`left`)
			const connection = setup.batches.connect({
				actor: `alice`,
				session: `alice-editor`,
			})
			expect(
				await connection.propose({
					affectedMembers: [leftAddress],
					dependencies: [],
					domain: setup.domain.identity,
					group: `typing`,
					id: `edit`,
					operations: [
						{
							address: leftAddress,
							id: `edit:0`,
							model: mosaicDomainMemberModelIdentity(leftModel),
							operation: { amount: 1, type: `add` },
						},
					],
					protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
					sequence: 1,
					session: `alice-editor`,
				}),
			).toMatchObject({ status: `accepted` })
			await setup.history.flush()
			const history = setup.history.connect({
				actor: `alice`,
				session: `alice-history`,
			})
			const snapshot = await history.snapshot()
			const request = history.request({
				cursor: snapshot.cursor,
				id: `undo`,
				mode: `undo`,
				sequence: 1,
				session: `alice-history`,
			})
			if (invalid === `unmodeled`) {
				await expect(request).rejects.toThrow(`no operation model`)
			} else {
				expect(await request).toMatchObject({
					reason: expect.stringContaining(`participates in history`),
					status: `rejected`,
				})
			}
			history[Symbol.dispose]()
			setup.history[Symbol.dispose]()
			setup.batches.dispose()
			setup.domain[Symbol.dispose]()
		}
	})

	test(`one compensation atomically undoes a heterogeneous gesture without erasing a foreign edit`, async () => {
		const { batches, domain, history, left, segments, silo } = await fixture()
		const leftAddress = domain.address(`left`)
		const segmentAddress = domain.address(`segments`, `paragraph-a`)
		const alice = batches.connect({ actor: `alice`, session: `alice-editor` })
		const bob = batches.connect({ actor: `bob`, session: `bob-editor` })
		const accepted = await alice.propose({
			affectedMembers: [leftAddress, segmentAddress],
			dependencies: [],
			domain: domain.identity,
			group: `alice-drag`,
			id: `alice-batch-1`,
			operations: [
				{
					address: leftAddress,
					id: `alice-left`,
					model: mosaicDomainMemberModelIdentity(leftModel),
					operation: { amount: 2, type: `add` },
				},
				{
					address: segmentAddress,
					id: `alice-segment`,
					model: mosaicDomainMemberModelIdentity(segmentModel),
					operation: { amount: 3, type: `add` },
				},
			],
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: 1,
			session: `alice-editor`,
		})
		expect(accepted.status).toBe(`accepted`)
		const foreign = await bob.propose({
			affectedMembers: [leftAddress],
			dependencies: [`alice-batch-1`],
			domain: domain.identity,
			group: `bob-type`,
			id: `bob-batch-1`,
			operations: [
				{
					address: leftAddress,
					id: `bob-left`,
					model: mosaicDomainMemberModelIdentity(leftModel),
					operation: { amount: 7, type: `add` },
				},
			],
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: 1,
			session: `bob-editor`,
		})
		expect(foreign.status).toBe(`accepted`)
		await history.flush()
		const forged = await alice.propose({
			affectedMembers: [leftAddress],
			dependencies: [`bob-batch-1`],
			domain: domain.identity,
			group: `forged-history`,
			id: `forged-history`,
			operations: [
				{
					address: leftAddress,
					id: `forged-history-operation`,
					model: mosaicDomainMemberModelIdentity(leftModel),
					operation: {
						mode: `undo`,
						targetOperationIds: [`alice-left`],
						type: `history`,
					},
				},
			],
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: 2,
			session: `alice-editor`,
		})
		expect(forged).toMatchObject({
			rejection: { code: `unauthorized` },
			status: `rejected`,
		})
		expect(batches.revision).toBe(2)

		const first = history.connect({ actor: `alice`, session: `tab-a` })
		const before = await first.snapshot()
		expect(before.horizon).toMatchObject({ canUndo: true, undoSteps: 1 })
		const undone = await first.request({
			cursor: before.cursor,
			id: `alice-history-1`,
			mode: `undo`,
			sequence: 1,
			session: `tab-a`,
		})
		expect(undone.status).toBe(`accepted`)
		expect(counterValue(silo.getState(left))).toBe(7)
		expect(counterValue(silo.getState(segments, `paragraph-a`))).toBe(0)
		expect(batches.revision).toBe(3)

		const redoCursor = (
			undone as { snapshot: { cursor: MosaicDomainHistoryCursor } }
		).snapshot.cursor
		const redone = await first.request({
			cursor: redoCursor,
			id: `alice-history-2`,
			mode: `redo`,
			sequence: 2,
			session: `tab-a`,
		})
		expect(redone.status).toBe(`accepted`)
		expect(counterValue(silo.getState(left))).toBe(9)
		expect(counterValue(silo.getState(segments, `paragraph-a`))).toBe(3)
		expect(batches.revision).toBe(4)
	})

	test(`concurrent sessions for one actor reject the stale cursor and retain complete steps`, async () => {
		const { batches, domain, history } = await fixture(undefined, `concurrency`)
		const address = domain.address(`left`)
		const writer = batches.connect({ actor: `alice`, session: `writer` })
		for (let index = 1; index <= 5; index++) {
			const result = await writer.propose({
				affectedMembers: [address],
				dependencies: index === 1 ? [] : [`edit-${index - 1}`],
				domain: domain.identity,
				group: `gesture-${index}`,
				id: `edit-${index}`,
				operations: [
					{
						address,
						id: `change-${index}`,
						model: mosaicDomainMemberModelIdentity(leftModel),
						operation: { amount: index, type: `add` },
					},
				],
				protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
				sequence: index,
				session: `writer`,
			})
			expect(result.status).toBe(`accepted`)
		}
		await history.flush()
		const left = history.connect({ actor: `alice`, session: `left` })
		const right = history.connect({ actor: `alice`, session: `right` })
		const cursor = (await left.snapshot()).cursor
		const [one, two] = await Promise.all([
			left.request({
				cursor,
				id: `left-undo`,
				mode: `undo`,
				sequence: 1,
				session: `left`,
			}),
			right.request({
				cursor,
				id: `right-undo`,
				mode: `undo`,
				sequence: 1,
				session: `right`,
			}),
		])
		expect([one.status, two.status].sort()).toEqual([`accepted`, `rejected`])
		const stale = [one, two].find(({ status }) => status === `rejected`)
		expect(stale).toMatchObject({ recovery: `history-resnapshot` })
		const horizon = await left.snapshot()
		expect(horizon.horizon).toMatchObject({
			canRedo: true,
			truncatedBeforeRevision: 2,
			undoSteps: 2,
		})
		expect(history.stats).toMatchObject({
			actorCount: 1,
			gestureCount: 3,
			operationCount: 3,
		})
	})

	test(`a gesture spanning unloaded family members stays atomic for a partially resident client`, async () => {
		const setup = await fixture(undefined, `partial-history`)
		const leftAddress = setup.domain.address(`left`)
		const segmentAddress = setup.domain.address(`segments`, `unloaded`)
		const writer = setup.batches.connect({
			actor: `alice`,
			session: `writer`,
		})
		const edit = await writer.propose({
			affectedMembers: [leftAddress, segmentAddress],
			dependencies: [],
			domain: setup.domain.identity,
			group: `cross-residency-gesture`,
			id: `cross-residency-edit`,
			operations: [
				{
					address: leftAddress,
					id: `cross-residency-left`,
					model: mosaicDomainMemberModelIdentity(leftModel),
					operation: { amount: 1, type: `add` },
				},
				{
					address: segmentAddress,
					id: `cross-residency-segment`,
					model: mosaicDomainMemberModelIdentity(segmentModel),
					operation: { amount: 2, type: `add` },
				},
			],
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: 1,
			session: `writer`,
		})
		expect(edit.status).toBe(`accepted`)
		await setup.history.flush()

		const readerSilo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `partial-history-reader`,
		})
		const readerLeftAtom = readerSilo.atom<CounterState>({
			default: EMPTY_COUNTER,
			key: `readerLeft`,
		})
		const readerSegmentAtoms = readerSilo.atomFamily<CounterState, string>({
			default: EMPTY_COUNTER,
			key: `readerSegment`,
		})
		const readerDefinition = mosaicDomain({
			configSchema: z.object({}).strict(),
			key: `history-domain`,
			members: {
				left: {
					model: leftModel,
					role: `durable`,
					schema: counterStateSchema,
					token: readerLeftAtom,
				},
				segments: {
					keySchema: z.string().min(1),
					model: segmentModel,
					role: `durable`,
					schema: counterStateSchema,
					token: readerSegmentAtoms,
				},
			},
			version: 1,
		})
		const readerDomain = await readerDefinition.activate({
			config: {},
			instance: `document`,
			store: readerSilo.store,
		})
		const residencyServer = createMosaicDomainResidencyServer({
			batches: setup.batches,
			domain: setup.domain,
		})
		const reader = createMosaicDomainResidencyClient({
			actor: `reader`,
			domain: readerDomain,
			session: `reader`,
			transport: residencyServer.connect({
				actor: `reader`,
				session: `reader`,
			}),
		})
		const residentLeft = await reader.acquire(readerDomain.address(`left`))
		expect(counterValue(readerSilo.getState(residentLeft.token))).toBe(1)
		const residentAtoms = readerSilo.store.atoms.size

		const connection = setup.history.connect({
			actor: `alice`,
			session: `history-tab`,
		})
		const snapshot = await connection.snapshot()
		const undo = await connection.request({
			cursor: snapshot.cursor,
			id: `partial-history-undo`,
			mode: `undo`,
			sequence: 1,
			session: `history-tab`,
		})
		expect(undo.status).toBe(`accepted`)
		for (let turn = 0; turn < 8; turn++) await Promise.resolve()
		expect(counterValue(readerSilo.getState(residentLeft.token))).toBe(0)
		expect(readerSilo.store.atoms.size).toBe(residentAtoms)
		expect(counterValue(setup.silo.getState(setup.segments, `unloaded`))).toBe(0)
		await reader.dispose()
	})

	test(`fails closed at request, session, protection, and recovery boundaries`, async () => {
		const setup = await fixture(undefined, `history-boundaries`)
		setup.history[Symbol.dispose]()
		const history = createMosaicDomainHistoryCoordinator({
			batches: setup.batches,
			domain: setup.domain,
			limits: {
				maxRecentRequests: 1,
				maxSessions: 1,
				undoStepsPerActor: 3,
			},
			minimumRecoveryRevision: () => 100,
			storage: setup.storage,
		})
		expect(() => history.connect({ actor: ``, session: `bad` })).toThrow(
			`requires actor and session IDs`,
		)
		const empty = history.connect({ actor: `alice`, session: `empty` })
		const emptySnapshot = await empty.snapshot()
		expect(
			await empty.request({
				cursor: emptySnapshot.cursor,
				id: `empty`,
				mode: `undo`,
				sequence: 1,
				session: `empty`,
			}),
		).toMatchObject({ status: `unavailable` })
		expect(
			await empty.request({
				cursor: emptySnapshot.cursor,
				id: `gap`,
				mode: `undo`,
				sequence: 2,
				session: `empty`,
			}),
		).toMatchObject({ recovery: `retry`, status: `rejected` })
		expect(
			await empty.request({
				cursor: emptySnapshot.cursor,
				id: `invalid`,
				mode: `undo`,
				sequence: 1,
				session: `wrong`,
			}),
		).toMatchObject({ status: `rejected` })

		const address = setup.domain.address(`left`)
		const writer = setup.batches.connect({ actor: `alice`, session: `writer` })
		for (let sequence = 1; sequence <= 2; sequence++) {
			const result = await writer.propose({
				affectedMembers: [address],
				dependencies: sequence === 1 ? [] : [`group-batch-${sequence - 1}`],
				domain: setup.domain.identity,
				group: `one-group`,
				id: `group-batch-${sequence}`,
				operations: [
					{
						address,
						id: `group-operation-${sequence}`,
						model: mosaicDomainMemberModelIdentity(leftModel),
						operation: { amount: 1, type: `add` },
					},
				],
				protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
				sequence,
				session: `writer`,
			})
			expect(result.status).toBe(`accepted`)
		}
		await history.flush()
		expect(history.stats).toMatchObject({ gestureCount: 1, operationCount: 2 })

		const primary = history.connect({ actor: `alice`, session: `primary` })
		const current = await primary.snapshot()
		expect(
			await primary.request({
				cursor: emptySnapshot.cursor,
				id: `stale`,
				mode: `undo`,
				sequence: 1,
				session: `primary`,
			}),
		).toMatchObject({ recovery: `domain-resnapshot`, status: `rejected` })
		const request = {
			cursor: current.cursor,
			id: `boundary-undo`,
			mode: `undo` as const,
			sequence: 1,
			session: `primary`,
		}
		const undone = await primary.request(request)
		expect(undone.status).toBe(`accepted`)
		expect(await primary.request(request)).toEqual(undone)
		expect(
			await primary.request({ ...request, id: `sequence-reuse` }),
		).toMatchObject({ recovery: `domain-resnapshot`, status: `rejected` })
		if (undone.status !== `accepted`) throw new Error(`Expected accepted undo`)
		const redone = await primary.request({
			cursor: undone.snapshot.cursor,
			id: `boundary-redo`,
			mode: `redo`,
			sequence: 2,
			session: `primary`,
		})
		expect(redone.status).toBe(`accepted`)
		expect(await primary.request(request)).toMatchObject({
			recovery: `history-resnapshot`,
			status: `rejected`,
		})
		const another = history.connect({ actor: `alice`, session: `another` })
		const anotherSnapshot = await another.snapshot()
		expect(
			await another.request({
				cursor: anotherSnapshot.cursor,
				id: `another`,
				mode: `undo`,
				sequence: 1,
				session: `another`,
			}),
		).toMatchObject({ recovery: `retry`, status: `rejected` })

		const protectionCheckpoint = createMosaicDomainCheckpointCoordinator({
			domain: setup.domain.identity,
			readMember: async ({ address: memberAddress }) => {
				const parsed = await setup.domain.parseAddress(memberAddress)
				const acquired = await setup.domain.acquire(parsed)
				return setup.silo.getState(acquired.token)
			},
			storage: setup.storage,
		})
		const protectionRoot = await protectionCheckpoint.checkpoint()
		await history.protect({
			id: `presence-anchor`,
			kind: `presence`,
			minimumRevision: 1,
			operationIds: [`group-operation-1`],
			rootKeys: [protectionRoot.rootKey],
		})
		expect(history.stats.protectionCount).toBe(1)
		const compacted = (await history.checkpoint.compactMember({
			address,
			revision: setup.batches.revision,
			value: setup.silo.getState(setup.left),
		})) as CounterState
		expect(compacted.changes).toHaveProperty(`group-operation-1`)
		const modelReferenced = (await history.checkpoint.compactMember({
			address,
			revision: setup.batches.revision,
			value: {
				baseline: -999,
				changes: {
					"model-reference": {
						active: true,
						actor: `alice`,
						amount: 1,
					},
				},
			},
		})) as CounterState
		expect(modelReferenced.changes).toHaveProperty(`model-reference`)
		await expect(
			history.protect({
				id: ``,
				kind: `presence`,
				minimumRevision: 0,
			}),
		).rejects.toThrow(`protection is invalid`)
		await history.releaseProtection(`presence-anchor`)
		expect(history.stats.protectionCount).toBe(0)

		empty[Symbol.dispose]()
		await expect(empty.snapshot()).rejects.toThrow(`connection is closed`)
		await expect(empty.request(request)).rejects.toThrow(`connection is closed`)
		history[Symbol.dispose]()
		history[Symbol.dispose]()
		await expect(primary.request(request)).rejects.toThrow(`history is disposed`)
	})

	test(`checkpoint integration compacts retired model history and restarts from its bounded index`, async () => {
		const { batches, domain, history, left, silo, storage } = await fixture(
			undefined,
			`checkpoint`,
		)
		const address = domain.address(`left`)
		const writer = batches.connect({ actor: `alice`, session: `writer` })
		for (let sequence = 1; sequence <= 8; sequence++) {
			await writer.propose({
				affectedMembers: [address],
				dependencies: sequence === 1 ? [] : [`batch-${sequence - 1}`],
				domain: domain.identity,
				group: `gesture-${sequence}`,
				id: `batch-${sequence}`,
				operations: [
					{
						address,
						id: `operation-${sequence}`,
						model: mosaicDomainMemberModelIdentity(leftModel),
						operation: { amount: 1, type: `add` },
					},
				],
				protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
				sequence,
				session: `writer`,
			})
		}
		await history.flush()
		const compactedRaceCut = (await history.checkpoint.compactMember({
			address,
			revision: 6,
			value: {
				baseline: 0,
				changes: Object.fromEntries(
					Array.from({ length: 6 }, (_, index) => [
						`operation-${index + 1}`,
						{
							active: true,
							actor: `alice`,
							amount: 1,
						},
					]),
				),
			},
		})) as CounterState
		expect(compactedRaceCut).toMatchObject({ baseline: 3 })
		expect(Object.keys(compactedRaceCut.changes).sort()).toEqual([
			`operation-4`,
			`operation-5`,
			`operation-6`,
		])
		await expect(
			history.checkpoint.compactMember({
				address,
				revision: 1,
				value: EMPTY_COUNTER,
			}),
		).rejects.toThrow(`expired race cut`)
		const persistent = history.connect({
			actor: `alice`,
			session: `persistent`,
		})
		const beforeUndo = await persistent.snapshot()
		const undone = await persistent.request({
			cursor: beforeUndo.cursor,
			id: `persistent-undo`,
			mode: `undo`,
			sequence: 1,
			session: `persistent`,
		})
		expect(undone.status).toBe(`accepted`)
		await expect(
			history.checkpoint.indexes({
				batches: [],
				fromRevision: 0,
				revision: 1,
			}),
		).rejects.toThrow(`expired race cut`)
		const checkpoint = createMosaicDomainCheckpointCoordinator({
			domain: domain.identity,
			indexes: history.checkpoint.indexes,
			readMember: async ({ address: requested, revision }) => {
				const parsed = await domain.parseAddress(requested)
				const acquired = await domain.acquire(parsed)
				return history.checkpoint.compactMember({
					address: requested,
					revision,
					value: silo.getState(acquired.token),
				})
			},
			storage,
		})
		await checkpoint.checkpoint()
		const compacted = await checkpoint.recover([address])
		const value = compacted.members[0]?.value as CounterState
		expect(counterValue(value)).toBe(7)
		expect(Object.keys(value.changes)).toHaveLength(3)
		expect(value.baseline).toBe(5)

		history[Symbol.dispose]()
		const restarted = createMosaicDomainHistoryCoordinator({
			batches,
			checkpoint,
			domain,
			limits: { maxCheckpointRaceSnapshots: 3, undoStepsPerActor: 3 },
			storage,
		})
		const returning = restarted.connect({
			actor: `alice`,
			session: `persistent`,
		})
		const snapshot = await returning.snapshot()
		expect(snapshot.horizon).toMatchObject({
			redoSteps: 1,
			truncatedBeforeRevision: 5,
			undoSteps: 2,
		})
		expect(restarted.stats.operationCount).toBe(3)
		const redone = await returning.request({
			cursor: snapshot.cursor,
			id: `persistent-redo`,
			mode: `redo`,
			sequence: 2,
			session: `persistent`,
		})
		expect(redone.status).toBe(`accepted`)
		expect(counterValue(silo.getState(left))).toBe(8)
	})

	test(`rejects malformed or over-bound restart indexes before observing history`, async () => {
		const setup = await fixture(undefined, `history-index-validation`)
		const address = setup.domain.address(`left`)
		const writer = setup.batches.connect({ actor: `alice`, session: `writer` })
		await writer.propose({
			affectedMembers: [address],
			dependencies: [],
			domain: setup.domain.identity,
			group: `validation-gesture`,
			id: `validation-batch`,
			operations: [
				{
					address,
					id: `validation-operation`,
					model: mosaicDomainMemberModelIdentity(leftModel),
					operation: { amount: 1, type: `add` },
				},
			],
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: 1,
			session: `writer`,
		})
		await setup.history.flush()
		const update = (
			await setup.history.checkpoint.indexes({
				batches: [],
				fromRevision: 0,
				revision: 1,
			})
		)[0]
		if (update === undefined) throw new Error(`Expected a history index`)
		const valid = update.value as {
			actors: {
				actor: string
				cursorRevision: number
				redo: unknown[]
				truncatedBeforeRevision: number
				undo: {
					actor: string
					firstRevision: number
					id: string
					lastRevision: number
					operations: {
						address: unknown
						id: string
						model: unknown
						operation: unknown
						revision: number
						session: string
					}[]
				}[]
			}[]
			headBatchId: string | null
			protocolVersion: number
			revision: number
			retiredBeforeRevision: number
			sessions: { actor: string; sequence: number; session: string }[]
		}
		const actor = valid.actors[0]
		const gesture = actor.undo[0]
		const operation = gesture.operations[0]
		const invalidIndexes: {
			limits?: { readonly maxOperationsPerGesture: number }
			revision?: number
			value: Json.Serializable
		}[] = [
			{ value: {} },
			{ value: { ...valid, headBatchId: `` } as Json.Serializable },
			{
				value: {
					...valid,
					actors: [{ ...actor, cursorRevision: 2 }],
				} as Json.Serializable,
			},
			{
				value: {
					...valid,
					actors: [
						{
							...actor,
							undo: [{ ...gesture, actor: `` }],
						},
					],
				} as Json.Serializable,
			},
			{
				value: {
					...valid,
					actors: [
						{
							...actor,
							undo: [
								{
									...gesture,
									operations: [{ ...operation, id: `` }],
								},
							],
						},
					],
				} as Json.Serializable,
			},
			{
				value: {
					...valid,
					actors: [
						{
							...actor,
							undo: [{ ...gesture, actor: `bob` }],
						},
					],
				} as Json.Serializable,
			},
			{
				limits: { maxOperationsPerGesture: 1 },
				value: {
					...valid,
					actors: [
						{
							...actor,
							undo: [
								{
									...gesture,
									operations: [operation, operation],
								},
							],
						},
					],
				} as Json.Serializable,
			},
			{ revision: 2, value: valid as Json.Serializable },
			{
				value: {
					...valid,
					sessions: [{ actor: ``, sequence: 1, session: `bad` }],
				} as Json.Serializable,
			},
		]
		for (const candidate of invalidIndexes) {
			const invalid = createMosaicDomainHistoryCoordinator({
				batches: setup.batches,
				checkpoint: {
					readIndex: () =>
						Promise.resolve({
							index: `history`,
							kind: `index`,
							path: `state`,
							revision: candidate.revision ?? 1,
							value: candidate.value,
						}),
				},
				domain: setup.domain,
				...(candidate.limits === undefined ? {} : { limits: candidate.limits }),
			})
			await expect(invalid.flush()).rejects.toThrow(`Mosaic Domain`)
			invalid[Symbol.dispose]()
		}
		expect(() =>
			createMosaicDomainHistoryCoordinator({
				batches: setup.batches,
				domain: setup.domain,
				limits: { maxActors: 0 },
			}),
		).toThrow(`positive safe integer`)
	})

	test(`bounds accepted-stream recovery and rolls retention failures back`, async () => {
		const setup = await fixture(undefined, `history-recovery-bounds`)
		setup.history[Symbol.dispose]()
		const address = setup.domain.address(`left`)
		const alice = setup.batches.connect({ actor: `alice`, session: `alice` })
		await alice.propose({
			affectedMembers: [address],
			dependencies: [],
			domain: setup.domain.identity,
			group: `alice-gesture`,
			id: `alice-edit`,
			operations: [
				{
					address,
					id: `alice-operation`,
					model: mosaicDomainMemberModelIdentity(leftModel),
					operation: { amount: 1, type: `add` },
				},
			],
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: 1,
			session: `alice`,
		})
		const late = createMosaicDomainHistoryCoordinator({
			batches: setup.batches,
			domain: setup.domain,
			limits: { maxActors: 1 },
		})
		await late.flush()
		expect(late.stats.actorCount).toBe(1)
		const supportedAlice = late.connect({
			actor: `alice`,
			session: `supported-alice`,
		})
		const aliceSnapshot = await supportedAlice.snapshot()
		expect(
			await supportedAlice.request({
				cursor: aliceSnapshot.cursor,
				id: `supported-alice-undo`,
				mode: `undo`,
				sequence: 1,
				session: `supported-alice`,
			}),
		).toMatchObject({ status: `accepted` })
		const maintenance = await alice.propose({
			affectedMembers: [address],
			dependencies: [`alice-edit`],
			domain: setup.domain.identity,
			group: `maintenance`,
			id: `maintenance`,
			operations: [
				{
					address,
					id: `maintenance-operation`,
					model: mosaicDomainMemberModelIdentity(leftModel),
					operation: { type: `maintenance` },
				},
			],
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: 2,
			session: `alice`,
		})
		expect(maintenance.status).toBe(`accepted`)
		const bob = setup.batches.connect({ actor: `bob`, session: `bob` })
		await bob.propose({
			affectedMembers: [address],
			dependencies: [`maintenance`],
			domain: setup.domain.identity,
			group: `bob-gesture`,
			id: `bob-edit`,
			operations: [
				{
					address,
					id: `bob-operation`,
					model: mosaicDomainMemberModelIdentity(leftModel),
					operation: { amount: 1, type: `add` },
				},
			],
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: 1,
			session: `bob`,
		})
		await late.flush()
		expect(late.stats).toMatchObject({ actorCount: 1, gestureCount: 1 })
		expect((await supportedAlice.snapshot()).horizon.canRedo).toBe(true)
		expect(
			(
				await late
					.connect({ actor: `bob`, session: `unsupported-bob` })
					.snapshot()
			).horizon.canUndo,
		).toBe(false)

		let failRetention = false
		const rollback = createMosaicDomainHistoryCoordinator({
			batches: setup.batches,
			domain: setup.domain,
			storage: {
				deleteCheckpointRetentionLease() {
					if (failRetention) throw new Error(`retention unavailable`)
					return 0
				},
				upsertCheckpointRetentionLease() {
					if (failRetention) throw new Error(`retention unavailable`)
					return 0
				},
			},
		})
		await rollback.flush()
		await rollback.protect({
			id: `session`,
			kind: `session`,
			minimumRevision: 0,
		})
		failRetention = true
		await expect(
			rollback.protect({
				id: `session`,
				kind: `session`,
				minimumRevision: 1,
			}),
		).rejects.toThrow(`retention unavailable`)
		expect(rollback.stats.protectionCount).toBe(1)
		await expect(
			rollback.protect({
				id: `second`,
				kind: `outbox`,
				minimumRevision: 0,
			}),
		).rejects.toThrow(`retention unavailable`)
		expect(rollback.stats.protectionCount).toBe(1)
		await expect(rollback.releaseProtection(`session`)).rejects.toThrow(
			`retention unavailable`,
		)
		expect(rollback.stats.protectionCount).toBe(1)
		rollback[Symbol.dispose]()
		await Promise.resolve()
		await Promise.resolve()
	})

	test(`fails closed on malformed recovered history semantics`, async () => {
		const setup = await fixture(undefined, `history-recovery-semantics`)
		setup.history[Symbol.dispose]()
		const address = setup.domain.address(`left`)
		const add = (amount: number): CounterOperation => ({
			amount,
			type: `add`,
		})
		const historyOperation = (mode: `redo` | `undo`): CounterOperation => ({
			mode,
			targetOperationIds: [`target`],
			type: `history`,
		})
		const cases: readonly {
			readonly expected: string
			readonly headRevision: number
			readonly limits?: { readonly maxOperationsPerGesture: number }
			readonly tail: readonly MosaicAcceptedDomainBatchEnvelope[]
		}[] = [
			{
				expected: `revision gap`,
				headRevision: 2,
				tail: [acceptedEnvelope(setup.domain, address, 2, [add(1)])],
			},
			{
				expected: `mix history changes and compensation`,
				headRevision: 1,
				tail: [
					acceptedEnvelope(setup.domain, address, 1, [
						add(1),
						historyOperation(`undo`),
					]),
				],
			},
			{
				expected: `gesture exceeds its bounds`,
				headRevision: 1,
				limits: { maxOperationsPerGesture: 1 },
				tail: [acceptedEnvelope(setup.domain, address, 1, [add(1), add(2)])],
			},
			{
				expected: `must use one mode`,
				headRevision: 1,
				tail: [
					acceptedEnvelope(setup.domain, address, 1, [
						historyOperation(`undo`),
						historyOperation(`redo`),
					]),
				],
			},
			{
				expected: `stale history cursor`,
				headRevision: 1,
				tail: [
					acceptedEnvelope(setup.domain, address, 1, [historyOperation(`undo`)]),
				],
			},
			{
				expected: `gesture exceeds its bounds`,
				headRevision: 2,
				limits: { maxOperationsPerGesture: 1 },
				tail: [
					acceptedEnvelope(setup.domain, address, 1, [add(1)], `gesture`),
					acceptedEnvelope(setup.domain, address, 2, [add(2)], `gesture`),
				],
			},
		]
		for (const candidate of cases) {
			const coordinator = createMosaicDomainHistoryCoordinator({
				batches: recoveringBatchServer(candidate.headRevision, candidate.tail),
				domain: setup.domain,
				...(candidate.limits === undefined ? {} : { limits: candidate.limits }),
			})
			await expect(coordinator.flush()).rejects.toThrow(candidate.expected)
			coordinator[Symbol.dispose]()
		}
		const incomplete = createMosaicDomainHistoryCoordinator({
			batches: recoveringBatchServer(1, []),
			domain: setup.domain,
		})
		await expect(incomplete.flush()).rejects.toThrow(`incomplete tail`)
		incomplete[Symbol.dispose]()
		const unregistered = createMosaicDomainHistoryCoordinator({
			batches: recoveringBatchServer(1, [
				acceptedEnvelope(setup.domain, address, 1, [add(1)]),
			]),
			domain: setup.domain,
		})
		await unregistered.flush()
		const connection = unregistered.connect({
			actor: `alice`,
			session: `unregistered`,
		})
		const snapshot = await connection.snapshot()
		await expect(
			connection.request({
				cursor: snapshot.cursor,
				id: `unregistered`,
				mode: `undo`,
				sequence: 1,
				session: `unregistered`,
			}),
		).rejects.toThrow(`proposal capability is invalid`)
		unregistered[Symbol.dispose]()
	})

	test(`skips history-free members and orders supported session watermarks`, async () => {
		const setup = await fixture(undefined, `history-free-members`)
		const address = setup.domain.address(`left`)
		const writer = setup.batches.connect({ actor: `alice`, session: `writer` })
		await writer.propose({
			affectedMembers: [address],
			dependencies: [],
			domain: setup.domain.identity,
			group: `session-order`,
			id: `session-order`,
			operations: [
				{
					address,
					id: `session-order-operation`,
					model: mosaicDomainMemberModelIdentity(leftModel),
					operation: { amount: 1, type: `add` },
				},
			],
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: 1,
			session: `writer`,
		})
		await setup.history.flush()
		const alpha = setup.history.connect({ actor: `alice`, session: `alpha` })
		const alphaSnapshot = await alpha.snapshot()
		const undone = await alpha.request({
			cursor: alphaSnapshot.cursor,
			id: `alpha-undo`,
			mode: `undo`,
			sequence: 1,
			session: `alpha`,
		})
		if (undone.status !== `accepted`) throw new Error(`Expected alpha undo`)
		const beta = setup.history.connect({ actor: `alice`, session: `beta` })
		expect(
			await beta.request({
				cursor: undone.snapshot.cursor,
				id: `beta-redo`,
				mode: `redo`,
				sequence: 1,
				session: `beta`,
			}),
		).toMatchObject({ status: `accepted` })
		const indexes = await setup.history.checkpoint.indexes({
			batches: [],
			fromRevision: 0,
			revision: setup.batches.revision,
		})
		expect(indexes).toHaveLength(1)

		const unmodeled = setup.domain.address(`unmodeled`)
		const historyFree = setup.domain.address(`historyFree`)
		const recovered = createMosaicDomainHistoryCoordinator({
			batches: recoveringBatchServer(2, [
				acceptedEnvelope(setup.domain, unmodeled, 1, [
					{ amount: 1, type: `add` },
				]),
				acceptedEnvelope(setup.domain, historyFree, 2, [
					{ amount: 1, type: `add` },
				]),
			]),
			domain: setup.domain,
		})
		await recovered.flush()
		expect(
			await recovered.checkpoint.compactMember({
				address: unmodeled,
				revision: 2,
				value: EMPTY_COUNTER,
			}),
		).toEqual(EMPTY_COUNTER)
		expect(
			await recovered.checkpoint.compactMember({
				address: historyFree,
				revision: 2,
				value: EMPTY_COUNTER,
			}),
		).toEqual(EMPTY_COUNTER)
		recovered[Symbol.dispose]()
	})

	test(`maps an authoritative compensation rejection to Domain recovery`, async () => {
		const setup = await fixture(undefined, `history-authorization`)
		setup.history[Symbol.dispose]()
		const batches = createMosaicDomainBatchServer({
			authorize: ({ batch }) =>
				batch.operations.every(
					({ operation }) => (operation as CounterOperation).type !== `history`,
				),
			domain: setup.domain,
		})
		const history = createMosaicDomainHistoryCoordinator({
			batches,
			domain: setup.domain,
		})
		const address = setup.domain.address(`left`)
		const writer = batches.connect({ actor: `alice`, session: `writer` })
		const edit = await writer.propose({
			affectedMembers: [address],
			dependencies: [],
			domain: setup.domain.identity,
			group: `authorized-edit`,
			id: `authorized-edit`,
			operations: [
				{
					address,
					id: `authorized-operation`,
					model: mosaicDomainMemberModelIdentity(leftModel),
					operation: { amount: 1, type: `add` },
				},
			],
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: 1,
			session: `writer`,
		})
		expect(edit.status).toBe(`accepted`)
		await history.flush()
		const connection = history.connect({ actor: `alice`, session: `history` })
		const snapshot = await connection.snapshot()
		expect(
			await connection.request({
				cursor: snapshot.cursor,
				id: `rejected-history`,
				mode: `undo`,
				sequence: 1,
				session: `history`,
			}),
		).toMatchObject({ recovery: `domain-resnapshot`, status: `rejected` })
		expect(batches.revision).toBe(1)
	})

	test(`rejects non-conforming and incomplete model compensations`, async () => {
		const setup = await fixture(undefined, `history-model-compensation`)
		const address = setup.domain.address(`left`)
		const writer = setup.batches.connect({ actor: `alice`, session: `writer` })
		await writer.propose({
			affectedMembers: [address],
			dependencies: [],
			domain: setup.domain.identity,
			group: `first-gesture`,
			id: `first-edit`,
			operations: [
				{
					address,
					id: `first-operation`,
					model: mosaicDomainMemberModelIdentity(leftModel),
					operation: { amount: 1, type: `add` },
				},
			],
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: 1,
			session: `writer`,
		})
		await setup.history.flush()
		counterCompensationOverrides.set(`history-left`, () => ({
			amount: 0,
			type: `add`,
		}))
		try {
			const connection = setup.history.connect({
				actor: `alice`,
				session: `non-conforming`,
			})
			const snapshot = await connection.snapshot()
			expect(
				await connection.request({
					cursor: snapshot.cursor,
					id: `non-conforming`,
					mode: `undo`,
					sequence: 1,
					session: `non-conforming`,
				}),
			).toMatchObject({
				reason: expect.stringContaining(`non-conforming history compensation`),
				status: `rejected`,
			})
		} finally {
			counterCompensationOverrides.delete(`history-left`)
		}

		await writer.propose({
			affectedMembers: [address],
			dependencies: [`first-edit`],
			domain: setup.domain.identity,
			group: `two-operation-gesture`,
			id: `second-edit`,
			operations: [1, 2].map((amount) => ({
				address,
				id: `second-operation-${amount}`,
				model: mosaicDomainMemberModelIdentity(leftModel),
				operation: { amount, type: `add` as const },
			})),
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: 2,
			session: `writer`,
		})
		await setup.history.flush()
		counterCompensationOverrides.set(`history-left`, ({ mode, targets }) => ({
			mode,
			targetOperationIds: [targets[0].id],
			type: `history`,
		}))
		try {
			const connection = setup.history.connect({
				actor: `alice`,
				session: `incomplete`,
			})
			const snapshot = await connection.snapshot()
			expect(
				await connection.request({
					cursor: snapshot.cursor,
					id: `incomplete`,
					mode: `undo`,
					sequence: 1,
					session: `incomplete`,
				}),
			).toMatchObject({
				reason: expect.stringContaining(`stale history compensation`),
				status: `rejected`,
			})
		} finally {
			counterCompensationOverrides.delete(`history-left`)
		}
	})

	test(`run-text exposes the same Domain policy and compacts retired actions without moving anchors`, () => {
		const Text = mosaicText({ maximumRunGraphemes: 1 })
		const text = new Text()
		text.change(
			{ text: `ABC`, type: `replace-text` },
			{
				actor: `alice`,
				dependencies: [],
				group: `typing`,
				id: `edit-1`,
				now: 1,
				revision: null,
				session: `tab`,
			},
		)
		const anchor = text.positionAtOffset(2)
		const policy = Text.domainHistory
		const compacted = policy.compact(text.toJSON(), {
			retainedOperationIds: new Set(),
			throughRevision: 1,
		})
		const restored = Text.fromJSON(compacted)
		expect(restored.text).toBe(`ABC`)
		expect(restored.resolvePosition(anchor)).toBe(2)
		expect(compacted.actions.length).toBeLessThanOrEqual(2)
		expect(policy.classify({ deleted: [], inserted: [], type: `edit` })).toEqual(
			{
				kind: `change`,
			},
		)
		expect(
			policy.compensate({
				mode: `undo`,
				targets: [{ id: `edit-1` }],
			}),
		).toEqual({
			mode: `undo`,
			targetOperationIds: [`edit-1`],
			type: `history`,
		})

		for (let index = 0; index < 50; index++) {
			text.change(
				{ type: `undo` },
				{
					actor: `alice`,
					dependencies: [],
					group: null,
					id: `undo-${index}`,
					now: index * 2 + 2,
					revision: null,
					session: `tab`,
				},
			)
			text.change(
				{ type: `redo` },
				{
					actor: `alice`,
					dependencies: [],
					group: null,
					id: `redo-${index}`,
					now: index * 2 + 3,
					revision: null,
					session: `tab`,
				},
			)
		}
		const boundedActive = policy.compact(text.toJSON(), {
			retainedOperationIds: new Set([`edit-1`]),
			throughRevision: 101,
		})
		expect(boundedActive.actions).toHaveLength(1)
		expect(Text.fromJSON(boundedActive).text).toBe(`ABC`)
		text.change(
			{ type: `undo` },
			{
				actor: `alice`,
				dependencies: [],
				group: null,
				id: `final-undo`,
				now: 103,
				revision: null,
				session: `tab`,
			},
		)
		const boundedInactive = policy.compact(text.toJSON(), {
			retainedOperationIds: new Set([`edit-1`]),
			throughRevision: 102,
		})
		expect(boundedInactive.actions).toHaveLength(2)
		expect(Text.fromJSON(boundedInactive).text).toBe(``)

		const collision = new Text()
		collision.change(
			{ text: `A`, type: `replace-text` },
			{
				actor: `alice`,
				dependencies: [],
				group: `collision-retained`,
				id: `mosaic:text:baseline:5:active`,
				now: 104,
				revision: null,
				session: `tab`,
			},
		)
		collision.change(
			{ text: `AB`, type: `replace-text` },
			{
				actor: `alice`,
				dependencies: [`mosaic:text:baseline:5:active`],
				group: `collision-retired`,
				id: `collision-retired`,
				now: 105,
				revision: null,
				session: `tab`,
			},
		)
		const collisionCompacted = policy.compact(collision.toJSON(), {
			retainedOperationIds: new Set([`mosaic:text:baseline:5:active`]),
			throughRevision: 5,
		})
		expect(new Set(collisionCompacted.actions.map(({ id }) => id)).size).toBe(
			collisionCompacted.actions.length,
		)
		expect(Text.fromJSON(collisionCompacted).text).toBe(`AB`)

		const forgedBaseline = structuredClone(compacted)
		const baseline = forgedBaseline.actions.find(({ id }) =>
			id.startsWith(`mosaic:text:baseline:`),
		)
		if (baseline === undefined) throw new Error(`Expected compacted baseline`)
		Object.assign(baseline, { session: `attacker` })
		expect(() => Text.fromJSON(forgedBaseline)).toThrow(
			`Invalid Mosaic text snapshot`,
		)
		expect(() =>
			policy.compact(text.toJSON(), {
				retainedOperationIds: new Set(),
				throughRevision: -1,
			}),
		).toThrow(`Invalid Mosaic text history compaction revision`)

		const fullyProtected = policy.compact(text.toJSON(), {
			retainedOperationIds: new Set([`final-undo`]),
			throughRevision: 103,
		})
		expect(Text.fromJSON(fullyProtected).text).toBe(``)
		expect(
			policy.compact(fullyProtected, {
				retainedOperationIds: new Set(
					fullyProtected.actions.map(({ id }) => id),
				),
				throughRevision: 104,
			}),
		).toEqual(fullyProtected)

		const inactive = new Text()
		inactive.change(
			{ text: `Z`, type: `replace-text` },
			{
				actor: `alice`,
				dependencies: [],
				group: `inactive-edit`,
				id: `inactive-edit`,
				now: 106,
				revision: null,
				session: `tab`,
			},
		)
		inactive.change(
			{ type: `undo` },
			{
				actor: `alice`,
				dependencies: [`inactive-edit`],
				group: null,
				id: `inactive-undo`,
				now: 107,
				revision: null,
				session: `tab`,
			},
		)
		const inactiveCompacted = policy.compact(inactive.toJSON(), {
			retainedOperationIds: new Set(),
			throughRevision: 108,
		})
		expect(Text.fromJSON(inactiveCompacted).text).toBe(``)
		expect(inactiveCompacted.actions).toHaveLength(2)

		const invalidBoundary = structuredClone(compacted)
		const boundaryRun = invalidBoundary.runs[0]
		if (boundaryRun === undefined) throw new Error(`Expected compacted run`)
		Object.assign(boundaryRun, {
			after: { offset: boundaryRun.graphemes + 1, runId: boundaryRun.id },
		})
		expect(() => Text.fromJSON(invalidBoundary)).toThrow(
			`Invalid Mosaic text baseline boundary`,
		)

		const invalidDeletion = structuredClone(compacted)
		const deletionRun = invalidDeletion.runs[0]
		const deletionBaseline = invalidDeletion.actions.find(
			(action) =>
				action.id.startsWith(`mosaic:text:baseline:`) &&
				action.operation.type === `edit`,
		)
		if (deletionRun === undefined || deletionBaseline === undefined) {
			throw new Error(`Expected compacted deletion baseline`)
		}
		Object.assign(deletionBaseline.operation, {
			deleted: [
				{
					end: deletionRun.graphemes + 1,
					runId: deletionRun.id,
					start: 0,
				},
			],
		})
		expect(() => Text.fromJSON(invalidDeletion)).toThrow(
			`Invalid Mosaic text baseline deletion`,
		)
	})

	test(`realtime-testing drives three clients through interleaved history schedules`, async () => {
		const setup = await fixture(undefined, `scenario`)
		const address = setup.domain.address(`left`)
		const sequences = new Map<string, number>()
		let head: string | null = null
		const schedule = generateModelScenario<
			{ readonly amount: number; readonly gesture: string },
			never
		>({
			actions: 24,
			clientIds: [`alice-a`, `alice-b`, `bob`],
			generateAction: ({ clientId, index }) => ({
				amount: clientId === `bob` ? 2 : 1,
				gesture: `${clientId}:${index}`,
			}),
			seed: 0x16,
		})
		await runModelScenario({
			createRuntime: () => ({
				async applyAction(clientId, action) {
					const actor = clientId === `bob` ? `bob` : `alice`
					const sequence = (sequences.get(clientId) ?? 0) + 1
					sequences.set(clientId, sequence)
					const id = `scenario:${clientId}:${sequence}`
					const result = await setup.batches
						.connect({ actor, session: clientId })
						.propose({
							affectedMembers: [address],
							dependencies: head === null ? [] : [head],
							domain: setup.domain.identity,
							group: action.gesture,
							id,
							operations: [
								{
									address,
									id: `${id}:operation`,
									model: mosaicDomainMemberModelIdentity(leftModel),
									operation: { amount: action.amount, type: `add` },
								},
							],
							protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
							sequence,
							session: clientId,
						})
					if (result.status !== `accepted`)
						throw new Error(result.rejection.reason)
					head = id
				},
				assertInvariants() {
					expect(
						counterValue(setup.silo.getState(setup.left)),
					).toBeGreaterThanOrEqual(0)
					expect(setup.history.stats.operationCount).toBeLessThanOrEqual(6)
				},
				quiesce: () => setup.history.flush(),
			}),
			schedule,
		})
		expect(setup.history.stats.actorCount).toBe(2)
	})

	test(`100,001 accepted batches leave bounded receipts after a checkpoint cut`, async () => {
		const storage = new InMemoryMosaicDomainCheckpointStorage({
			maxRecentReceipts: 64,
			maxSessionWatermarks: 1,
		})
		const domain = {
			definition: { key: `stress-history`, version: 1 },
			instance: `document`,
		} as const
		const address: MosaicDomainMemberAddress<typeof domain> = {
			domain,
			member: `counter`,
		}
		for (let revision = 1; revision <= 100_001; revision++) {
			const id = `stress-${revision}`
			const batch: MosaicDomainBatchProposal<typeof domain> & {
				readonly actor: string
			} = {
				affectedMembers: [address],
				actor: `stress`,
				dependencies: revision === 1 ? [] : [`stress-${revision - 1}`],
				domain,
				group: id,
				id,
				operations: [
					{
						address,
						id: `${id}:operation`,
						model: { key: `stress`, version: 1 },
						operation: { amount: 1, type: `add` },
					},
				],
				protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
				sequence: revision,
				session: `stress`,
			}
			const result = storage.appendBatch({
				accepted: { batch, revision },
				expectedRevision: revision - 1,
				fingerprint: id,
			})
			if (result.status !== `accepted`) throw new Error(result.status)
		}
		const checkpoint = createMosaicDomainCheckpointCoordinator({
			domain,
			limits: { maxRecoveryBatches: 100_001 },
			readMember: () => EMPTY_COUNTER as CounterState & Json.Serializable,
			storage,
		})
		await checkpoint.checkpoint()
		const collected = storage.collectCheckpointGarbage({
			domain,
			expectedRetentionEpoch: storage.checkpointHead(domain).retentionEpoch,
		})
		expect(collected.status).toBe(`collected`)
		expect(storage.stats(domain)).toMatchObject({
			operationReceiptCount: 64,
			receiptCount: 64,
			sessionWatermarkCount: 1,
			tailBatchCount: 0,
		})
		const retired = storage.appendBatch({
			accepted: {
				batch: {
					affectedMembers: [address],
					actor: `stress`,
					dependencies: [],
					domain,
					group: null,
					id: `retired-retry`,
					operations: [
						{
							address,
							id: `retired-operation`,
							model: { key: `stress`, version: 1 },
							operation: { amount: 1, type: `add` },
						},
					],
					protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
					sequence: 1,
					session: `stress`,
				},
				revision: 100_002,
			},
			expectedRevision: 100_001,
			fingerprint: `retired`,
		})
		expect(retired).toEqual({ actualSequence: 100_001, status: `retired` })
		const capacity = storage.appendBatch({
			accepted: {
				batch: {
					affectedMembers: [address],
					actor: `another`,
					dependencies: [],
					domain,
					group: null,
					id: `new-session`,
					operations: [
						{
							address,
							id: `new-session-operation`,
							model: { key: `stress`, version: 1 },
							operation: { amount: 1, type: `add` },
						},
					],
					protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
					sequence: 1,
					session: `another`,
				},
				revision: 100_002,
			},
			expectedRevision: 100_001,
			fingerprint: `new-session`,
		})
		expect(capacity).toEqual({ status: `session-capacity` })
	})
})
