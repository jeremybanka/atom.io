import { Silo } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import {
	applyMosaicDomainBatch,
	assertMosaicDomainBatchEnvelope,
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
	mosaicDomain,
	type MosaicDomainBatchEnvelope,
	type MosaicDomainBatchProposal,
	mosaicDomainMemberModelIdentity,
	type MosaicDomainTransceiverModel,
	type MosaicDomainValueModel,
	type MosaicOperationSignal,
	mosaicText,
	type MosaicTextOperation,
	type MosaicTextSnapshot,
	preflightMosaicDomainBatch,
	reprojectMosaicDomainBatches,
	revertMosaicDomainBatch,
} from "atom.io/realtime"
import {
	createMosaicDomainBatchClient,
	type MosaicDomainBatchClientTransport,
} from "atom.io/realtime-client"
import {
	createMosaicDomainBatchServer,
	InMemoryMosaicDomainBatchStorage,
	type MosaicDomainBatchAppendRequest,
	type MosaicDomainBatchStorageAdapter,
} from "atom.io/realtime-server"
import { testMosaicDomainBatchStorageAdapter } from "atom.io/realtime-testing"
import { headless } from "atom.io/realtime-testing/headless"
import { vitest } from "vitest"
import { z } from "zod"

const pathModel = {
	identity: { key: `path-order`, version: 1 },
	kind: `value`,
	operationSchema: z
		.object({ path: z.string(), type: z.literal(`append`) })
		.transform((operation) => ({
			...operation,
			path: operation.path.trim(),
		})),
	reduce(value, operation) {
		return value.includes(operation.path) ? value : [...value, operation.path]
	},
} satisfies MosaicDomainValueModel<string[], { path: string; type: `append` }>

type Node = { x: number; y: number }

const nodeModel = {
	identity: { key: `node-register`, version: 1 },
	kind: `value`,
	operationSchema: z.object({
		type: z.literal(`move`),
		x: z.number(),
		y: z.number(),
	}),
	reduce(_value, operation) {
		return { x: operation.x, y: operation.y }
	},
} satisfies MosaicDomainValueModel<Node, { type: `move`; x: number; y: number }>

async function designFixture(
	name: string,
	silo = new Silo({ isProduction: false, lifespan: `ephemeral`, name }),
) {
	const pathsAtom = silo.atom<string[]>({ default: [], key: `paths` })
	const nodeAtoms = silo.atomFamily<Node, string>({
		default: { x: 0, y: 0 },
		key: `node`,
	})
	const summarySelector = silo.selector<{
		node: Node
		paths: readonly string[]
	}>({
		get: ({ get }) => ({
			node: get(nodeAtoms, `n1`),
			paths: get(pathsAtom),
		}),
		key: `summary`,
	})
	const definition = mosaicDomain({
		configSchema: z.object({}),
		key: `mos11-design`,
		members: {
			nodes: {
				keySchema: z.string(),
				model: nodeModel,
				role: `durable`,
				schema: z.object({ x: z.number(), y: z.number() }),
				token: nodeAtoms,
			},
			paths: {
				model: pathModel,
				role: `durable`,
				schema: z.array(z.string()),
				token: pathsAtom,
			},
		},
		version: 1,
	})
	const domain = await definition.activate({
		config: {},
		instance: `document`,
		store: silo.store,
	})
	return { domain, nodeAtoms, pathsAtom, silo, summarySelector }
}

async function revisionFixture(name: string) {
	const silo = new Silo({ isProduction: false, lifespan: `ephemeral`, name })
	const revisionAtom = silo.atom<number>({ default: 0, key: `revision` })
	const revisionModel = {
		identity: { key: `revision-stamp`, version: 1 },
		kind: `value`,
		operationSchema: z.object({ type: z.literal(`stamp`) }),
		reduce(_value, _operation, context) {
			return context.revision ?? -1
		},
	} satisfies MosaicDomainValueModel<number, { type: `stamp` }>
	const definition = mosaicDomain({
		configSchema: z.object({}),
		key: `mos11-revision`,
		members: {
			revision: {
				model: revisionModel,
				role: `durable`,
				schema: z.number(),
				token: revisionAtom,
			},
		},
		version: 1,
	})
	const domain = await definition.activate({
		config: {},
		instance: `document`,
		store: silo.store,
	})
	return { domain, revisionAtom, silo }
}

const suffixModel = {
	identity: { key: `suffix-register`, version: 1 },
	kind: `value`,
	operationSchema: z
		.object({ type: z.literal(`set`), value: z.string() })
		.transform((operation) => ({
			...operation,
			value: `${operation.value}!`,
		})),
	reduce(_value, operation) {
		return operation.value
	},
} satisfies MosaicDomainValueModel<string, { type: `set`; value: string }>

async function transformedFixture(name: string) {
	const silo = new Silo({ isProduction: false, lifespan: `ephemeral`, name })
	const valueAtoms = silo.atomFamily<string, string>({
		default: ``,
		key: `value`,
	})
	const definition = mosaicDomain({
		configSchema: z.object({}),
		key: `mos11-transformed`,
		members: {
			values: {
				keySchema: z.string().transform((key) => key.trim()),
				model: suffixModel,
				role: `durable`,
				schema: z.string(),
				token: valueAtoms,
			},
		},
		version: 1,
	})
	const domain = await definition.activate({
		config: {},
		instance: `document`,
		store: silo.store,
	})
	return { domain, silo, valueAtoms }
}

const BatchText = mosaicText()

async function textFixture(name: string) {
	const silo = new Silo({ isProduction: false, lifespan: `ephemeral`, name })
	const textAtom = silo.mutableAtom<InstanceType<typeof BatchText>>({
		class: BatchText,
		key: `text`,
	})
	const textModel = {
		class: BatchText,
		kind: `transceiver`,
		operationSchema: z.custom<MosaicTextOperation>(
			(value) => typeof value === `object` && value !== null,
		),
	} satisfies MosaicDomainTransceiverModel<InstanceType<typeof BatchText>>
	const definition = mosaicDomain({
		configSchema: z.object({}),
		key: `mos11-text`,
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
	return { domain, silo, textAtom, textModel }
}

const proposal = (
	domain: Awaited<ReturnType<typeof designFixture>>[`domain`],
	overrides: Partial<MosaicDomainBatchProposal> = {},
): MosaicDomainBatchProposal => {
	const paths = domain.address(`paths`)
	const node = domain.address(`nodes`, `n1`)
	return {
		affectedMembers: [paths, node],
		dependencies: [],
		domain: domain.identity,
		group: `gesture-1`,
		id: `batch-1`,
		operations: [
			{
				address: paths,
				id: `operation-path`,
				model: mosaicDomainMemberModelIdentity(pathModel),
				operation: { path: `p1`, type: `append` },
			},
			{
				address: node,
				id: `operation-node`,
				model: mosaicDomainMemberModelIdentity(nodeModel),
				operation: { type: `move`, x: 10, y: 20 },
			},
		],
		protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
		session: `session-a`,
		...overrides,
	}
}

async function waitFor(
	condition: () => boolean,
	message: string,
): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (condition()) return
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
	}
	throw new Error(message)
}

describe(`Mosaic Domain atomic batches`, () => {
	test(`rejects every malformed or over-capacity envelope boundary`, async () => {
		const state = await designFixture(`envelope-boundaries`)
		const valid: MosaicDomainBatchEnvelope = {
			...proposal(state.domain),
			actor: `alice`,
		}
		expect(() => {
			assertMosaicDomainBatchEnvelope(valid)
		}).not.toThrow()
		const firstAddress = valid.affectedMembers[0]
		const secondOperation = valid.operations[1]
		const malformed: unknown[] = [
			null,
			{ ...valid, protocolVersion: 2 },
			{ ...valid, actor: `` },
			{ ...valid, actor: `x`.repeat(513) },
			{ ...valid, id: 1 },
			{ ...valid, session: `` },
			{ ...valid, group: 1 },
			{ ...valid, dependencies: null },
			{ ...valid, dependencies: [`same`, `same`] },
			{ ...valid, dependencies: [``] },
			{ ...valid, operations: null },
			{ ...valid, operations: [] },
			{ ...valid, affectedMembers: null },
			{
				...valid,
				operations: [
					{ ...valid.operations[0], operation: { invalid: undefined } },
				],
				affectedMembers: [firstAddress],
			},
			{ ...valid, operations: [null] },
			{
				...valid,
				operations: [{ ...valid.operations[0], id: `` }],
				affectedMembers: [firstAddress],
			},
			{
				...valid,
				operations: [
					valid.operations[0],
					{ ...secondOperation, id: valid.operations[0].id },
				],
			},
			{ ...valid, affectedMembers: [firstAddress, firstAddress] },
			{ ...valid, affectedMembers: [firstAddress] },
			{
				...valid,
				affectedMembers: [
					firstAddress,
					{ ...valid.affectedMembers[1], key: `another-node` },
				],
			},
		]
		for (const value of malformed) {
			expect(() => {
				assertMosaicDomainBatchEnvelope(value as MosaicDomainBatchEnvelope)
			}).toThrow()
		}
		expect(() => {
			assertMosaicDomainBatchEnvelope(valid, {
				maxBytes: 1,
				maxMembers: 256,
				maxOperations: 1024,
			})
		}).toThrow(`bytes`)
		expect(() => {
			assertMosaicDomainBatchEnvelope(valid, {
				maxBytes: 256 * 1024,
				maxMembers: 1,
				maxOperations: 1024,
			})
		}).toThrow(`member count`)
		expect(() => {
			assertMosaicDomainBatchEnvelope(valid, {
				maxBytes: 256 * 1024,
				maxMembers: 256,
				maxOperations: 1,
			})
		}).toThrow(`operation count`)
	})

	test(`rejects domain, model, operation, and value contract violations before settlement`, async () => {
		const state = await designFixture(`preflight-contract-boundaries`)
		const batch: MosaicDomainBatchEnvelope = {
			...proposal(state.domain),
			actor: `alice`,
		}
		await expect(
			preflightMosaicDomainBatch(state.domain, {
				...batch,
				domain: { ...batch.domain, instance: `another-document` },
			}),
		).rejects.toThrow(`another domain`)
		await expect(
			preflightMosaicDomainBatch(state.domain, {
				...batch,
				operations: batch.operations.map((operation, index) =>
					index === 0
						? { ...operation, model: { key: `wrong`, version: 1 } }
						: operation,
				),
			}),
		).rejects.toThrow(`incompatible model metadata`)

		const silo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `preflight-member-contracts`,
		})
		const localAtom = silo.atom<number>({ default: 0, key: `local` })
		const unmodeledAtom = silo.atom<number>({ default: 0, key: `unmodeled` })
		const memberDefinition = mosaicDomain({
			configSchema: z.object({}),
			key: `mos11-member-contracts`,
			members: {
				local: { role: `ephemeral`, schema: z.number(), token: localAtom },
				unmodeled: {
					role: `durable`,
					schema: z.number(),
					token: unmodeledAtom,
				},
			},
			version: 1,
		})
		const memberDomain = await memberDefinition.activate({
			config: {},
			instance: `document`,
			store: silo.store,
		})
		const memberBatch = (
			member: `local` | `unmodeled`,
		): MosaicDomainBatchEnvelope => {
			const address = memberDomain.address(member)
			return {
				affectedMembers: [address],
				actor: `alice`,
				dependencies: [],
				domain: memberDomain.identity,
				group: null,
				id: `${member}-batch`,
				operations: [
					{
						address,
						id: `${member}-operation`,
						model: { key: `unused`, version: 1 },
						operation: { type: `set` },
					},
				],
				protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
				session: `session-a`,
			}
		}
		await expect(
			preflightMosaicDomainBatch(memberDomain, memberBatch(`local`)),
		).rejects.toThrow(`is not durable`)
		await expect(
			preflightMosaicDomainBatch(memberDomain, memberBatch(`unmodeled`)),
		).rejects.toThrow(`has no batch model`)
		expect(silo.getState(localAtom)).toBe(0)
		expect(silo.getState(unmodeledAtom)).toBe(0)

		const unsafeSilo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `preflight-unsafe-models`,
		})
		const unsafeAtom = unsafeSilo.atom<number>({ default: 0, key: `unsafe` })
		const nonserialOperationModel = {
			identity: { key: `nonserial-operation`, version: 1 },
			kind: `value`,
			operationSchema: z
				.object({ type: z.literal(`invalid-operation`) })
				.transform(() => ({ invalid: undefined })),
			reduce: () => 1,
		} as unknown as MosaicDomainValueModel<number, Json.Serializable>
		const nonserialValueModel = {
			identity: { key: `nonserial-value`, version: 1 },
			kind: `value`,
			operationSchema: z.object({ type: z.literal(`invalid-value`) }),
			reduce: () => ({ invalid: () => undefined }),
		} as unknown as MosaicDomainValueModel<number, Json.Serializable>
		const wireValueModel = {
			identity: { key: `wire-value`, version: 1 },
			kind: `value`,
			operationSchema: z.object({ type: z.literal(`wire-value`) }),
			reduce: () => ({ toJSON: () => 42 }),
		} as unknown as MosaicDomainValueModel<number, Json.Serializable>
		const unsafeDefinition = mosaicDomain({
			configSchema: z.object({}),
			key: `mos11-unsafe-models`,
			members: {
				unsafe: {
					model: nonserialOperationModel,
					role: `durable`,
					schema: z.number(),
					token: unsafeAtom,
				},
			},
			version: 1,
		})
		const unsafeDomain = await unsafeDefinition.activate({
			config: {},
			instance: `document`,
			store: unsafeSilo.store,
		})
		const unsafeBatch = (
			domain: MosaicDomainBatchEnvelope[`domain`],
			address: MosaicDomainBatchEnvelope[`affectedMembers`][number],
			model: MosaicDomainValueModel<number, Json.Serializable>,
			operation: Json.Serializable,
		): MosaicDomainBatchEnvelope => {
			return {
				affectedMembers: [address],
				actor: `alice`,
				dependencies: [],
				domain,
				group: null,
				id: `unsafe-batch`,
				operations: [
					{
						address,
						id: `unsafe-operation`,
						model: mosaicDomainMemberModelIdentity(model),
						operation,
					},
				],
				protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
				session: `session-a`,
			}
		}
		await expect(
			preflightMosaicDomainBatch(
				unsafeDomain,
				unsafeBatch(
					unsafeDomain.identity,
					unsafeDomain.address(`unsafe`),
					nonserialOperationModel,
					{ type: `invalid-operation` },
				),
			),
		).rejects.toThrow(`non-serializable operation`)

		unsafeDomain[Symbol.dispose]()
		const valueDefinition = mosaicDomain({
			configSchema: z.object({}),
			key: `mos11-unsafe-models`,
			members: {
				unsafe: {
					model: nonserialValueModel,
					role: `durable`,
					schema: z.number(),
					token: unsafeAtom,
				},
			},
			version: 1,
		})
		const valueDomain = await valueDefinition.activate({
			config: {},
			instance: `value-document`,
			store: unsafeSilo.store,
		})
		const valueAddress = valueDomain.address(`unsafe`)
		const valueBatch: MosaicDomainBatchEnvelope = {
			...unsafeBatch(valueDomain.identity, valueAddress, nonserialValueModel, {
				type: `invalid-value`,
			}),
			affectedMembers: [valueAddress],
			domain: valueDomain.identity,
			operations: [
				{
					address: valueAddress,
					id: `unsafe-value-operation`,
					model: mosaicDomainMemberModelIdentity(nonserialValueModel),
					operation: { type: `invalid-value` },
				},
			],
		}
		await expect(
			preflightMosaicDomainBatch(valueDomain, valueBatch),
		).rejects.toThrow(`non-serializable value`)

		valueDomain[Symbol.dispose]()
		const wireDefinition = mosaicDomain({
			configSchema: z.object({}),
			key: `mos11-unsafe-models`,
			members: {
				unsafe: {
					model: wireValueModel,
					role: `durable`,
					schema: z.number(),
					token: unsafeAtom,
				},
			},
			version: 1,
		})
		const wireDomain = await wireDefinition.activate({
			config: {},
			instance: `wire-document`,
			store: unsafeSilo.store,
		})
		const wireAddress = wireDomain.address(`unsafe`)
		const prepared = await preflightMosaicDomainBatch(wireDomain, {
			...unsafeBatch(wireDomain.identity, wireAddress, wireValueModel, {
				type: `wire-value`,
			}),
			affectedMembers: [wireAddress],
			domain: wireDomain.identity,
			operations: [
				{
					address: wireAddress,
					id: `wire-operation`,
					model: mosaicDomainMemberModelIdentity(wireValueModel),
					operation: { type: `wire-value` },
				},
			],
		})
		applyMosaicDomainBatch(prepared)
		expect(unsafeSilo.getState(unsafeAtom)).toBe(42)

		const text = await textFixture(`preflight-text-decisions`)
		const textAddress = text.domain.address(`text`)
		const missingAnchor: MosaicTextOperation = {
			deletedIds: [],
			inserted: [
				{
					after: `missing-anchor`,
					before: null,
					id: `text-decision-operation:node:000000`,
					value: `X`,
				},
			],
			type: `edit`,
		}
		const textBatch = (
			dependencies: readonly string[],
		): MosaicDomainBatchEnvelope => ({
			affectedMembers: [textAddress],
			actor: `alice`,
			dependencies,
			domain: text.domain.identity,
			group: null,
			id: `text-decision-batch`,
			operations: [
				{
					address: textAddress,
					id: `text-decision-operation`,
					model: mosaicDomainMemberModelIdentity(text.textModel),
					operation: missingAnchor,
				},
			],
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			session: `session-a`,
		})
		await expect(
			preflightMosaicDomainBatch(text.domain, textBatch([`future-batch`])),
		).rejects.toThrow(`missing model dependencies`)
		await expect(
			preflightMosaicDomainBatch(text.domain, textBatch([])),
		).rejects.toThrow(`Unknown predecessor anchor`)
	})

	test(`keeps prepared batches capability-bound across apply, revert, and reprojection`, async () => {
		const state = await designFixture(`prepared-capabilities`)
		const batch: MosaicDomainBatchEnvelope = {
			...proposal(state.domain),
			actor: `alice`,
		}
		const prepared = await preflightMosaicDomainBatch(state.domain, batch)
		applyMosaicDomainBatch(prepared)
		applyMosaicDomainBatch(prepared)
		expect(state.silo.getState(state.pathsAtom)).toEqual([`p1`])
		await expect(
			reprojectMosaicDomainBatches(state.domain, [prepared, prepared], []),
		).rejects.toThrow(`removed twice`)
		await reprojectMosaicDomainBatches(state.domain, [prepared], [])
		expect(state.silo.getState(state.pathsAtom)).toEqual([])
		revertMosaicDomainBatch(prepared)
		await expect(
			reprojectMosaicDomainBatches(state.domain, [prepared], []),
		).rejects.toThrow(`only applied batches`)
		expect(() => {
			applyMosaicDomainBatch({ batch, members: batch.affectedMembers })
		}).toThrow(`cannot be forged`)
		state.domain[Symbol.dispose]()
		await expect(
			preflightMosaicDomainBatch(state.domain, batch),
		).rejects.toThrow(`disposed`)
	})

	test(`fails closed across client recovery and lifecycle boundaries`, async () => {
		const makeAccepted = (
			state: Awaited<ReturnType<typeof designFixture>>,
			revision: number,
			id: string,
			path: string,
		) => ({
			batch: {
				...proposal(state.domain, {
					id,
					operations: proposal(state.domain).operations.map(
						(operation, index) => ({
							...operation,
							id: `${id}-operation-${index}`,
							operation:
								index === 0
									? { path, type: `append` }
									: { type: `move`, x: revision, y: revision },
						}),
					),
				}),
				actor: `bob`,
			},
			revision,
		})

		const gapState = await designFixture(`client-recovery-gap`)
		const gap = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: gapState.domain,
			session: `session-a`,
			transport: {
				propose: () => Promise.reject(new Error(`not used`)),
				recover: () =>
					Promise.resolve({
						headRevision: 2,
						tail: [makeAccepted(gapState, 2, `gap`, `gap`)],
					}),
				subscribe: () => () => undefined,
			},
		})
		await expect(gap.start()).rejects.toThrow(`recovery gap`)
		expect(gap.state.status).toBe(`rejected`)

		const incompleteState = await designFixture(`client-incomplete-recovery`)
		const incomplete = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: incompleteState.domain,
			session: `session-a`,
			transport: {
				propose: () => Promise.reject(new Error(`not used`)),
				recover: () => Promise.resolve({ headRevision: 1, tail: [] }),
				subscribe: () => () => undefined,
			},
		})
		await expect(incomplete.start()).rejects.toThrow(`incomplete tail`)
		expect(incomplete.state.status).toBe(`rejected`)

		const offlineState = await designFixture(`client-offline-recovery`)
		const offline = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: offlineState.domain,
			session: `session-a`,
			transport: {
				propose: () => Promise.reject(new Error(`not used`)),
				recover: () => Promise.reject(new Error(`network unavailable`)),
				subscribe: () => () => undefined,
			},
		})
		await expect(offline.start()).rejects.toThrow(`network unavailable`)
		expect(offline.state.status).toBe(`offline`)

		const liveState = await designFixture(`client-lifecycle`)
		let broadcast:
			| ((accepted: ReturnType<typeof makeAccepted>) => void)
			| undefined
		let unsubscribeCount = 0
		const live = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: liveState.domain,
			session: `session-a`,
			transport: {
				propose: () => Promise.reject(new Error(`not used`)),
				recover: () => Promise.resolve({ headRevision: 0, tail: [] }),
				subscribe: (listener) => {
					broadcast = listener
					return () => {
						unsubscribeCount++
					}
				},
			},
		})
		const listenerErrors = vitest
			.spyOn(liveState.silo.store.logger, `error`)
			.mockImplementation(() => undefined)
		let firstNotification = true
		live.subscribe(() => {
			if (firstNotification) firstNotification = false
			else throw new Error(`client listener failed`)
		})
		await live.start()
		expect(listenerErrors).toHaveBeenCalled()
		await live.start()
		await expect(live.submit([])).rejects.toThrow(`at least one operation`)
		const first = makeAccepted(liveState, 1, `accepted-1`, `one`)
		broadcast?.(first)
		await waitFor(
			() => live.state.revision === 1,
			`Client did not reach revision 1`,
		)
		broadcast?.(first)
		const second = makeAccepted(liveState, 2, `accepted-2`, `two`)
		broadcast?.(second)
		await waitFor(
			() => live.state.revision === 2,
			`Client did not reach revision 2`,
		)
		broadcast?.(first)
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
		expect(live.state.revision).toBe(2)
		live[Symbol.dispose]()
		live[Symbol.dispose]()
		expect(unsubscribeCount).toBe(1)
		await expect(live.start()).rejects.toThrow(`disposed`)
		await expect(live.flush()).rejects.toThrow(`disposed`)
		await expect(
			live.submit({
				address: liveState.domain.address(`paths`),
				operation: { path: `never`, type: `append` },
			}),
		).rejects.toThrow(`disposed`)
		listenerErrors.mockRestore()
	})

	test(`settles heterogeneous members atomically for several clients`, async () => {
		const serverState = await designFixture(`server`)
		const aliceState = await designFixture(`alice`)
		const bobState = await designFixture(`bob`)
		const server = createMosaicDomainBatchServer({ domain: serverState.domain })
		const alice = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: aliceState.domain,
			session: `session-a`,
			transport: server.connect({ actor: `alice`, session: `session-a` }),
		})
		const bob = createMosaicDomainBatchClient({
			actor: `bob`,
			domain: bobState.domain,
			session: `session-b`,
			transport: server.connect({ actor: `bob`, session: `session-b` }),
		})
		await Promise.all([alice.start(), bob.start()])

		const observations: Json.Serializable[] = []
		bobState.silo.subscribe(bobState.summarySelector, () => {
			observations.push(bobState.silo.getState(bobState.summarySelector))
		})
		await alice.submit(
			[
				{
					address: aliceState.domain.address(`paths`),
					operation: { path: `p1`, type: `append` },
				},
				{
					address: aliceState.domain.address(`nodes`, `n1`),
					operation: { type: `move`, x: 10, y: 20 },
				},
			],
			`draw-p1`,
		)
		await waitFor(
			() => bob.state.revision === 1,
			`Bob did not receive revision 1`,
		)

		for (const state of [serverState, aliceState, bobState]) {
			expect(state.silo.getState(state.pathsAtom)).toEqual([`p1`])
			expect(state.silo.getState(state.nodeAtoms, `n1`)).toEqual({
				x: 10,
				y: 20,
			})
		}
		expect(observations).toEqual([{ node: { x: 10, y: 20 }, paths: [`p1`] }])
	})

	test(`composes with realtime-testing's arbitrary multi-client topology`, async () => {
		const acceptedEvent = `mos11:accepted`
		const proposeEvent = `mos11:propose`
		const recoverEvent = `mos11:recover`
		let serverStatePromise: ReturnType<typeof designFixture> | undefined
		let batchServerPromise:
			| Promise<ReturnType<typeof createMosaicDomainBatchServer>>
			| undefined
		const scenario = headless({
			scenarioId: `mos11-batch`,
			server: (tools) => {
				serverStatePromise ??= designFixture(`server-harness`, tools.silo)
				batchServerPromise ??= serverStatePromise.then((state) =>
					createMosaicDomainBatchServer({ domain: state.domain }),
				)
				const connection = batchServerPromise.then((server) =>
					server.connect({ actor: tools.userKey, session: tools.sessionId }),
				)
				let unsubscribe: () => void = () => undefined
				void connection.then((connected) => {
					unsubscribe = connected.subscribe((accepted) => {
						tools.socket.emit(acceptedEvent, accepted)
					})
				})
				tools.socket.on(
					proposeEvent,
					(
						batch: MosaicDomainBatchProposal,
						respond: (
							result: Awaited<ReturnType<Awaited<typeof connection>[`propose`]>>,
						) => void,
					) => {
						void tools.work
							.track(
								connection.then((connected) => connected.propose(batch)),
								`propose Mosaic Domain batch`,
							)
							.then(respond)
					},
				)
				tools.socket.on(
					recoverEvent,
					(afterRevision: number, respond: (recovery: unknown) => void) => {
						void tools.work
							.track(
								connection.then((connected) => connected.recover(afterRevision)),
								`recover Mosaic Domain batches`,
							)
							.then(respond)
					},
				)
				return () => {
					unsubscribe()
				}
			},
		})
		const aliceHarness = scenario.createClient({ name: `alice` })
		const bobHarness = scenario.createClient({ name: `bob` })
		try {
			await scenario.waitForIdle()
			const serverState = await serverStatePromise!
			const aliceState = await designFixture(`alice-harness`, aliceHarness.silo)
			const bobState = await designFixture(`bob-harness`, bobHarness.silo)
			const socketTransport = (
				harness: typeof aliceHarness,
			): MosaicDomainBatchClientTransport => ({
				propose(batch) {
					return new Promise((resolve) => {
						harness.socket.emit(proposeEvent, batch, resolve)
					})
				},
				recover(afterRevision = 0) {
					return new Promise((resolve) => {
						harness.socket.emit(recoverEvent, afterRevision, resolve)
					})
				},
				subscribe(listener) {
					harness.socket.on(acceptedEvent, listener)
					return () => harness.socket.off(acceptedEvent, listener)
				},
			})
			const alice = createMosaicDomainBatchClient({
				actor: aliceHarness.userKey,
				domain: aliceState.domain,
				session: aliceHarness.sessionId,
				transport: socketTransport(aliceHarness),
			})
			const bob = createMosaicDomainBatchClient({
				actor: bobHarness.userKey,
				domain: bobState.domain,
				session: bobHarness.sessionId,
				transport: socketTransport(bobHarness),
			})
			await Promise.all([alice.start(), bob.start()])
			await aliceHarness.work.track(
				alice.submit([
					{
						address: aliceState.domain.address(`paths`),
						operation: { path: `from-harness`, type: `append` },
					},
					{
						address: aliceState.domain.address(`nodes`, `n1`),
						operation: { type: `move`, x: 7, y: 8 },
					},
				]),
				`submit Mosaic Domain batch`,
			)

			const converged = await scenario.waitForConvergence({
				participants: [
					{
						label: `server`,
						read: () => serverState.silo.getState(serverState.summarySelector),
					},
					{
						label: `alice`,
						read: () => aliceState.silo.getState(aliceState.summarySelector),
					},
					{
						label: `bob`,
						read: () => bobState.silo.getState(bobState.summarySelector),
					},
				],
			})
			expect(converged).toEqual({
				node: { x: 7, y: 8 },
				paths: [`from-harness`],
			})
		} finally {
			await scenario.teardown()
		}
	})

	test(`replaces provisional metadata with the accepted revision without rollback flicker`, async () => {
		const serverState = await revisionFixture(`server-revision`)
		const clientState = await revisionFixture(`client-revision`)
		const server = createMosaicDomainBatchServer({ domain: serverState.domain })
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: server.connect({ actor: `alice`, session: `session-a` }),
		})
		await client.start()
		const observations: number[] = []
		clientState.silo.subscribe(clientState.revisionAtom, () => {
			observations.push(clientState.silo.getState(clientState.revisionAtom))
		})

		await client.submit({
			address: clientState.domain.address(`revision`),
			operation: { type: `stamp` },
		})

		expect(clientState.silo.getState(clientState.revisionAtom)).toBe(1)
		expect(serverState.silo.getState(serverState.revisionAtom)).toBe(1)
		expect(observations).toEqual([-1, 1])
	})

	test(`stores and broadcasts schema-normalized operations`, async () => {
		const serverState = await designFixture(`server-normalized`)
		const clientState = await designFixture(`client-normalized`)
		const storage = new InMemoryMosaicDomainBatchStorage()
		const server = createMosaicDomainBatchServer({
			domain: serverState.domain,
			storage,
		})
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: server.connect({ actor: `alice`, session: `session-a` }),
		})
		await client.start()

		await client.submit({
			address: clientState.domain.address(`paths`),
			operation: { path: `  normalized  `, type: `append` },
		})

		const recovery = await storage.recover(serverState.domain.identity)
		expect(recovery.tail[0]?.batch.operations[0]?.operation).toEqual({
			path: `normalized`,
			type: `append`,
		})
		expect(clientState.silo.getState(clientState.pathsAtom)).toEqual([
			`normalized`,
		])
		expect(serverState.silo.getState(serverState.pathsAtom)).toEqual([
			`normalized`,
		])
	})

	test(`rejects non-idempotent operation normalization`, async () => {
		const serverState = await transformedFixture(`server-transform-once`)
		const clientState = await transformedFixture(`client-transform-once`)
		const storage = new InMemoryMosaicDomainBatchStorage()
		const server = createMosaicDomainBatchServer({
			domain: serverState.domain,
			storage,
		})
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: server.connect({ actor: `alice`, session: `session-a` }),
		})
		await client.start()

		await expect(
			client.submit({
				address: clientState.domain.address(`values`, ` key `),
				operation: { type: `set`, value: `value` },
			}),
		).rejects.toThrow(`schema must normalize idempotently`)

		expect(clientState.silo.getState(clientState.valueAtoms, `key`)).toBe(``)
		expect(serverState.silo.getState(serverState.valueAtoms, `key`)).toBe(``)
		expect((await storage.recover(serverState.domain.identity)).tail).toEqual([])
		expect(server.revision).toBe(0)
	})

	test(`rejects non-idempotent family-key normalization`, async () => {
		const silo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `non-idempotent-key`,
		})
		const nodeAtoms = silo.atomFamily<Node, string>({
			default: { x: 0, y: 0 },
			key: `node`,
		})
		const definition = mosaicDomain({
			configSchema: z.object({}),
			key: `mos11-non-idempotent-key`,
			members: {
				nodes: {
					keySchema: z.string().transform((key) => `${key}!`),
					model: nodeModel,
					role: `durable`,
					schema: z.object({ x: z.number(), y: z.number() }),
					token: nodeAtoms,
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
			domain.parseAddress(domain.address(`nodes`, `node`)),
		).rejects.toThrow(`schema must normalize idempotently`)
	})

	test(`settles append-only transceiver operations through the batch`, async () => {
		const serverState = await textFixture(`server-text`)
		const clientState = await textFixture(`client-text`)
		const server = createMosaicDomainBatchServer({ domain: serverState.domain })
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: server.connect({ actor: `alice`, session: `session-a` }),
		})
		await client.start()
		const preparation = new BatchText()
		const signal = preparation.change(
			{ text: `Collaborative`, type: `replace-text` },
			{
				actor: `alice`,
				dependencies: [],
				group: `typing`,
				id: `text-operation`,
				now: 0,
				revision: null,
				session: `session-a`,
			},
		) as MosaicOperationSignal<MosaicTextOperation>

		await client.submit(
			{
				address: clientState.domain.address(`text`),
				id: signal.id,
				operation: signal.operation,
			},
			signal.group,
		)

		expect({
			client: clientState.silo.getState(clientState.textAtom).text,
			clientState: client.state,
			server: serverState.silo.getState(serverState.textAtom).text,
		}).toEqual({
			client: `Collaborative`,
			clientState: expect.objectContaining({ revision: 1, status: `live` }),
			server: `Collaborative`,
		})
	})

	test(`rolls back every optimistic member when authorization rejects the final operation`, async () => {
		const serverState = await designFixture(`server-reject`)
		const clientState = await designFixture(`client-reject`)
		const server = createMosaicDomainBatchServer({
			authorize: ({ batch }) =>
				(batch.operations.at(-1)?.operation as { x?: number }).x !== 999,
			domain: serverState.domain,
		})
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: server.connect({ actor: `alice`, session: `session-a` }),
		})
		await client.start()
		const observations: Array<ReturnType<typeof clientState.silo.getState>> = []
		clientState.silo.subscribe(clientState.summarySelector, () => {
			observations.push(clientState.silo.getState(clientState.summarySelector))
		})

		await client.submit([
			{
				address: clientState.domain.address(`paths`),
				operation: { path: `rejected`, type: `append` },
			},
			{
				address: clientState.domain.address(`nodes`, `n1`),
				operation: { type: `move`, x: 999, y: 999 },
			},
		])

		expect(client.state.status).toBe(`rejected`)
		expect(client.state.pendingBatchIds).toEqual([])
		expect(clientState.silo.getState(clientState.summarySelector)).toEqual({
			node: { x: 0, y: 0 },
			paths: [],
		})
		expect(server.revision).toBe(0)
		expect(observations).toEqual([
			{ node: { x: 999, y: 999 }, paths: [`rejected`] },
			{ node: { x: 0, y: 0 }, paths: [] },
		])
	})

	test(`does not allocate a missing family member during rejected preflight`, async () => {
		const state = await designFixture(`server-rejected-family-preflight`)
		const server = createMosaicDomainBatchServer({
			authorize: () => false,
			domain: state.domain,
		})
		const address = state.domain.address(`nodes`, `never-allocated`)
		const before = state.silo.store.atoms.size
		const input = proposal(state.domain, {
			affectedMembers: [address],
			operations: [
				{
					address,
					id: `operation-never-allocated`,
					model: mosaicDomainMemberModelIdentity(nodeModel),
					operation: { type: `move`, x: 1, y: 2 },
				},
			],
		})

		await expect(
			server.connect({ actor: `alice`, session: `session-a` }).propose(input),
		).resolves.toMatchObject({
			rejection: { code: `unauthorized` },
			status: `rejected`,
		})
		expect(state.silo.store.atoms.size).toBe(before)
		expect(server.revision).toBe(0)
	})

	test(`removes an optimistic family allocation when its batch is rejected`, async () => {
		const serverState = await designFixture(`server-rejected-family-optimism`)
		const clientState = await designFixture(`client-rejected-family-optimism`)
		const server = createMosaicDomainBatchServer({
			authorize: () => false,
			domain: serverState.domain,
		})
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: server.connect({ actor: `alice`, session: `session-a` }),
		})
		await client.start()
		const before = clientState.silo.store.atoms.size
		const serverBefore = serverState.silo.store.atoms.size

		await client.submit({
			address: clientState.domain.address(`nodes`, `optimistic-only`),
			operation: { type: `move`, x: 1, y: 2 },
		})

		expect(client.state).toMatchObject({
			pendingBatchIds: [],
			problem: { code: `unauthorized` },
			status: `rejected`,
		})
		expect(clientState.silo.store.atoms.size).toBe(before)
		expect(serverState.silo.store.atoms.size).toBe(serverBefore)
	})

	test(`emits no Store or transport signal when final local preflight rolls back`, async () => {
		const state = await designFixture(`client-local-rollback`)
		let proposals = 0
		const transport: MosaicDomainBatchClientTransport = {
			propose() {
				proposals++
				throw new Error(`A rejected preflight must not reach transport.`)
			},
			recover() {
				return Promise.resolve({ headRevision: 0, tail: [] })
			},
			subscribe() {
				return () => undefined
			},
		}
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: state.domain,
			session: `session-a`,
			transport,
		})
		await client.start()
		let notifications = 0
		state.silo.subscribe(state.summarySelector, () => notifications++)

		await expect(
			client.submit([
				{
					address: state.domain.address(`paths`),
					operation: { path: `never-visible`, type: `append` },
				},
				{
					address: state.domain.address(`nodes`, `n1`),
					operation: { type: `move`, x: `invalid`, y: 1 },
				},
			]),
		).rejects.toThrow(`failed validation`)
		expect(notifications).toBe(0)
		expect(proposals).toBe(0)
		expect(state.silo.getState(state.summarySelector)).toEqual({
			node: { x: 0, y: 0 },
			paths: [],
		})
	})

	test(`does not acknowledge pending work from a reused accepted batch ID`, async () => {
		const state = await designFixture(`client-forged-acknowledgement`)
		const transport: MosaicDomainBatchClientTransport = {
			propose(batch) {
				return Promise.resolve({
					accepted: {
						batch: {
							...batch,
							actor: `mallory`,
						},
						revision: 1,
					},
					status: `accepted` as const,
				})
			},
			recover() {
				return Promise.resolve({ headRevision: 0, tail: [] })
			},
			subscribe() {
				return () => undefined
			},
		}
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: state.domain,
			session: `session-a`,
			transport,
		})
		await client.submit({
			address: state.domain.address(`paths`),
			operation: { path: `forged`, type: `append` },
		})

		expect(client.state).toMatchObject({
			pendingBatchIds: [],
			problem: { code: `batch-id-collision`, recovery: `resnapshot` },
			revision: 0,
			status: `rejected`,
		})
		expect(state.silo.getState(state.pathsAtom)).toEqual([])
	})

	test(`fails closed on invalid revisions and conflicting head replays`, async () => {
		const invalidState = await designFixture(`client-invalid-revision`)
		const invalidTransport: MosaicDomainBatchClientTransport = {
			propose(batch) {
				return Promise.resolve({
					accepted: { batch: { ...batch, actor: `alice` }, revision: 0 },
					status: `accepted` as const,
				})
			},
			recover() {
				return Promise.resolve({ headRevision: 0, tail: [] })
			},
			subscribe() {
				return () => undefined
			},
		}
		const invalidClient = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: invalidState.domain,
			session: `session-a`,
			transport: invalidTransport,
		})
		await invalidClient.submit({
			address: invalidState.domain.address(`paths`),
			operation: { path: `invalid`, type: `append` },
		})
		expect(invalidClient.state).toMatchObject({
			pendingBatchIds: [],
			problem: { code: `invalid-payload`, recovery: `resnapshot` },
			revision: 0,
			status: `rejected`,
		})
		expect(invalidState.silo.getState(invalidState.pathsAtom)).toEqual([])

		const replayState = await designFixture(`client-conflicting-replay`)
		let listener:
			| ((accepted: {
					batch: MosaicDomainBatchEnvelope
					revision: number
			  }) => void)
			| undefined
		let acceptedBatch: MosaicDomainBatchEnvelope | undefined
		const replayTransport: MosaicDomainBatchClientTransport = {
			propose(batch) {
				acceptedBatch = { ...batch, actor: `alice` }
				return Promise.resolve({
					accepted: { batch: acceptedBatch, revision: 1 },
					status: `accepted` as const,
				})
			},
			recover() {
				return Promise.resolve({ headRevision: 0, tail: [] })
			},
			subscribe(next) {
				listener = next
				return () => {
					listener = undefined
				}
			},
		}
		const replayClient = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: replayState.domain,
			session: `session-a`,
			transport: replayTransport,
		})
		await replayClient.submit({
			address: replayState.domain.address(`paths`),
			operation: { path: `accepted`, type: `append` },
		})
		listener?.({
			batch: {
				...acceptedBatch!,
				group: `conflicting-replay`,
			},
			revision: 1,
		})
		await waitFor(
			() => replayClient.state.status === `rejected`,
			`Conflicting head replay was not rejected`,
		)
		expect(replayClient.state).toMatchObject({
			pendingBatchIds: [],
			problem: { code: `invalid-payload`, recovery: `resnapshot` },
			revision: 1,
			status: `rejected`,
		})
		expect(replayState.silo.getState(replayState.pathsAtom)).toEqual([
			`accepted`,
		])
	})

	test(`fails closed on a malformed rejection acknowledgement`, async () => {
		const state = await designFixture(`client-malformed-rejection`)
		const transport: MosaicDomainBatchClientTransport = {
			propose() {
				return Promise.resolve({
					rejection: null,
					status: `rejected`,
				} as never)
			},
			recover() {
				return Promise.resolve({ headRevision: 0, tail: [] })
			},
			subscribe() {
				return () => undefined
			},
		}
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: state.domain,
			session: `session-a`,
			transport,
		})

		await client.submit({
			address: state.domain.address(`paths`),
			operation: { path: `discarded`, type: `append` },
		})

		expect(client.state).toMatchObject({
			pendingBatchIds: [],
			problem: { code: `invalid-payload`, recovery: `resnapshot` },
			revision: 0,
			status: `rejected`,
		})
		expect(state.silo.getState(state.pathsAtom)).toEqual([])
	})

	test(`fails closed when recovery reuses a pending batch ID`, async () => {
		const state = await designFixture(`client-forged-recovery`)
		let recoverPending = false
		let pendingProposal: MosaicDomainBatchProposal | undefined
		const transport: MosaicDomainBatchClientTransport = {
			propose(batch) {
				pendingProposal = batch
				return Promise.reject(new Error(`offline`))
			},
			recover() {
				if (!recoverPending || pendingProposal === undefined) {
					return Promise.resolve({ headRevision: 0, tail: [] })
				}
				return Promise.resolve({
					headRevision: 1,
					tail: [
						{
							batch: { ...pendingProposal, actor: `mallory` },
							revision: 1,
						},
					],
				})
			},
			subscribe() {
				return () => undefined
			},
		}
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: state.domain,
			session: `session-a`,
			transport,
		})
		await client.start()
		await client.submit({
			address: state.domain.address(`paths`),
			operation: { path: `pending`, type: `append` },
		})
		expect(state.silo.getState(state.pathsAtom)).toEqual([`pending`])

		recoverPending = true
		await client.flush()

		expect(client.state).toMatchObject({
			pendingBatchIds: [],
			problem: { code: `batch-id-collision`, recovery: `resnapshot` },
			revision: 0,
			status: `rejected`,
		})
		expect(state.silo.getState(state.pathsAtom)).toEqual([])
	})

	test(`deduplicates batches and fails closed on conflicting batch or operation IDs`, async () => {
		const state = await designFixture(`server-deduplication`)
		const storage = new InMemoryMosaicDomainBatchStorage()
		const server = createMosaicDomainBatchServer({
			domain: state.domain,
			storage,
		})
		const connection = server.connect({ actor: `alice`, session: `session-a` })
		const first = proposal(state.domain)
		const accepted = await connection.propose(first)
		const duplicate = await connection.propose(structuredClone(first))
		expect(accepted.status).toBe(`accepted`)
		expect(duplicate).toEqual(accepted)
		expect(server.revision).toBe(1)

		const batchCollision = await connection.propose({
			...first,
			operations: first.operations.map((operation, index) =>
				index === 0
					? { ...operation, operation: { path: `different`, type: `append` } }
					: operation,
			),
		})
		expect(batchCollision).toMatchObject({
			rejection: { code: `batch-id-collision` },
			status: `rejected`,
		})

		const operationCollision = await connection.propose({
			...first,
			affectedMembers: [first.affectedMembers[0]],
			dependencies: [first.id],
			id: `batch-2`,
			operations: [
				{
					...first.operations[0],
					operation: { path: `p2`, type: `append` },
				},
			],
		})
		expect(operationCollision).toMatchObject({
			rejection: { code: `operation-id-collision` },
			status: `rejected`,
		})
		expect((await storage.recover(state.domain.identity)).tail).toHaveLength(1)
	})

	test(`recovers a dropped batch boundary before applying a later revision`, async () => {
		const serverState = await designFixture(`server-gap`)
		const aliceState = await designFixture(`alice-gap`)
		const bobState = await designFixture(`bob-gap`)
		const server = createMosaicDomainBatchServer({ domain: serverState.domain })
		const alice = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: aliceState.domain,
			session: `session-a`,
			transport: server.connect({ actor: `alice`, session: `session-a` }),
		})
		const bobConnection = server.connect({ actor: `bob`, session: `session-b` })
		const droppedFirst: MosaicDomainBatchClientTransport = {
			...bobConnection,
			subscribe(listener) {
				return bobConnection.subscribe((accepted) => {
					if (accepted.revision !== 1) listener(accepted)
				})
			},
		}
		const bob = createMosaicDomainBatchClient({
			actor: `bob`,
			domain: bobState.domain,
			session: `session-b`,
			transport: droppedFirst,
		})
		await Promise.all([alice.start(), bob.start()])
		await alice.submit({
			address: aliceState.domain.address(`paths`),
			operation: { path: `p1`, type: `append` },
		})
		await alice.submit({
			address: aliceState.domain.address(`paths`),
			operation: { path: `p2`, type: `append` },
		})
		await waitFor(() => bob.state.revision === 2, `Bob did not recover the gap`)
		expect(bobState.silo.getState(bobState.pathsAtom)).toEqual([`p1`, `p2`])
	})

	test(`retains one whole offline batch and replays it idempotently`, async () => {
		const serverState = await designFixture(`server-offline`)
		const clientState = await designFixture(`client-offline`)
		const server = createMosaicDomainBatchServer({ domain: serverState.domain })
		const connection = server.connect({ actor: `alice`, session: `session-a` })
		let offline = true
		const transport: MosaicDomainBatchClientTransport = {
			...connection,
			async propose(batch) {
				if (offline) throw new Error(`offline`)
				return connection.propose(batch)
			},
		}
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport,
		})
		await client.start()
		await client.submit([
			{
				address: clientState.domain.address(`paths`),
				operation: { path: `offline`, type: `append` },
			},
			{
				address: clientState.domain.address(`nodes`, `n1`),
				operation: { type: `move`, x: 4, y: 5 },
			},
		])
		expect(client.state.status).toBe(`offline`)
		expect(client.state.pendingBatchIds).toHaveLength(1)
		offline = false
		await client.flush()
		expect(client.state).toMatchObject({
			pendingBatchIds: [],
			revision: 1,
			status: `live`,
		})
		expect(serverState.silo.getState(serverState.summarySelector)).toEqual({
			node: { x: 4, y: 5 },
			paths: [`offline`],
		})
	})

	test(`keeps later offline work behind the earlier pending batch`, async () => {
		const serverState = await designFixture(`server-offline-order`)
		const clientState = await designFixture(`client-offline-order`)
		const server = createMosaicDomainBatchServer({ domain: serverState.domain })
		const connection = server.connect({ actor: `alice`, session: `session-a` })
		const proposed: string[] = []
		let offline = true
		const transport: MosaicDomainBatchClientTransport = {
			...connection,
			propose(batch) {
				proposed.push(batch.id)
				return offline
					? Promise.reject(new Error(`offline`))
					: connection.propose(batch)
			},
		}
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport,
		})
		await client.start()
		await client.submit({
			address: clientState.domain.address(`paths`),
			operation: { path: `first`, type: `append` },
		})
		offline = false
		await client.submit({
			address: clientState.domain.address(`paths`),
			operation: { path: `second`, type: `append` },
		})

		expect(client.state.status).toBe(`offline`)
		expect(client.state.pendingBatchIds).toHaveLength(2)
		expect(proposed).toEqual([`alice:session-a:batch:0`])
		expect(clientState.silo.getState(clientState.pathsAtom)).toEqual([
			`first`,
			`second`,
		])

		await client.flush()

		expect(proposed).toEqual([
			`alice:session-a:batch:0`,
			`alice:session-a:batch:0`,
			`alice:session-a:batch:2`,
		])
		expect(client.state).toMatchObject({
			pendingBatchIds: [],
			revision: 2,
			status: `live`,
		})
		expect(serverState.silo.getState(serverState.pathsAtom)).toEqual([
			`first`,
			`second`,
		])
	})

	test(`atomically discards every optimistic batch after a protocol collision`, async () => {
		const state = await designFixture(`client-protocol-discard`)
		let recoverCollision = false
		let firstProposal: MosaicDomainBatchProposal | undefined
		const transport: MosaicDomainBatchClientTransport = {
			propose(batch) {
				firstProposal ??= batch
				return Promise.reject(new Error(`offline`))
			},
			recover() {
				if (!recoverCollision || firstProposal === undefined) {
					return Promise.resolve({ headRevision: 0, tail: [] })
				}
				return Promise.resolve({
					headRevision: 1,
					tail: [
						{
							batch: { ...firstProposal, actor: `mallory` },
							revision: 1,
						},
					],
				})
			},
			subscribe() {
				return () => undefined
			},
		}
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: state.domain,
			session: `session-a`,
			transport,
		})
		await client.start()
		await client.submit({
			address: state.domain.address(`paths`),
			operation: { path: `first`, type: `append` },
		})
		await client.submit({
			address: state.domain.address(`paths`),
			operation: { path: `second`, type: `append` },
		})
		const observations: Array<readonly string[]> = []
		state.silo.subscribe(state.pathsAtom, () => {
			observations.push(state.silo.getState(state.pathsAtom))
		})

		recoverCollision = true
		await client.flush()

		expect(client.state).toMatchObject({
			pendingBatchIds: [],
			problem: { code: `batch-id-collision`, recovery: `resnapshot` },
			revision: 0,
			status: `rejected`,
		})
		expect(state.silo.getState(state.pathsAtom)).toEqual([])
		expect(observations).toEqual([[]])
	})

	test(`ignores a stale rejection after broadcast acceptance`, async () => {
		const state = await designFixture(`client-stale-rejection`)
		let listener:
			| ((accepted: {
					batch: MosaicDomainBatchEnvelope
					revision: number
			  }) => void)
			| undefined
		const transport: MosaicDomainBatchClientTransport = {
			async propose(batch) {
				listener?.({ batch: { ...batch, actor: `alice` }, revision: 1 })
				await Promise.resolve()
				return {
					rejection: {
						batchId: batch.id,
						code: `backpressure`,
						reason: `stale response`,
						recovery: `retry`,
					},
					status: `rejected`,
				}
			},
			recover() {
				return Promise.resolve({ headRevision: 0, tail: [] })
			},
			subscribe(next) {
				listener = next
				return () => {
					listener = undefined
				}
			},
		}
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: state.domain,
			session: `session-a`,
			transport,
		})
		await client.start()

		await client.submit({
			address: state.domain.address(`paths`),
			operation: { path: `accepted`, type: `append` },
		})

		expect(client.state).toMatchObject({
			pendingBatchIds: [],
			problem: null,
			revision: 1,
			status: `live`,
		})
		expect(state.silo.getState(state.pathsAtom)).toEqual([`accepted`])
	})

	test(`ignores a transport failure after broadcast acceptance`, async () => {
		const state = await designFixture(`client-stale-transport-failure`)
		let listener:
			| ((accepted: {
					batch: MosaicDomainBatchEnvelope
					revision: number
			  }) => void)
			| undefined
		const transport: MosaicDomainBatchClientTransport = {
			propose(batch) {
				listener?.({ batch: { ...batch, actor: `alice` }, revision: 1 })
				return Promise.reject(new Error(`acknowledgement lost`))
			},
			recover() {
				return Promise.resolve({ headRevision: 0, tail: [] })
			},
			subscribe(next) {
				listener = next
				return () => {
					listener = undefined
				}
			},
		}
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: state.domain,
			session: `session-a`,
			transport,
		})
		await client.start()

		await client.submit({
			address: state.domain.address(`paths`),
			operation: { path: `accepted`, type: `append` },
		})

		expect(client.state).toMatchObject({
			pendingBatchIds: [],
			problem: null,
			revision: 1,
			status: `live`,
		})
		expect(state.silo.getState(state.pathsAtom)).toEqual([`accepted`])
	})

	test(`keeps durable acceptance when Store observers throw`, async () => {
		const serverState = await designFixture(`server-observer-error`)
		const clientState = await designFixture(`client-observer-error`)
		const server = createMosaicDomainBatchServer({ domain: serverState.domain })
		const serverErrors = vitest
			.spyOn(serverState.silo.store.logger, `error`)
			.mockImplementation(() => undefined)
		const clientErrors = vitest
			.spyOn(clientState.silo.store.logger, `error`)
			.mockImplementation(() => undefined)
		serverState.silo.subscribe(serverState.pathsAtom, () => {
			throw new Error(`server observer failed`)
		})
		clientState.silo.subscribe(clientState.pathsAtom, () => {
			throw new Error(`client observer failed`)
		})
		const client = createMosaicDomainBatchClient({
			actor: `alice`,
			domain: clientState.domain,
			session: `session-a`,
			transport: server.connect({ actor: `alice`, session: `session-a` }),
		})
		await client.start()

		await expect(
			client.submit({
				address: clientState.domain.address(`paths`),
				operation: { path: `committed`, type: `append` },
			}),
		).resolves.toBeUndefined()

		expect(server.revision).toBe(1)
		expect(client.state).toMatchObject({
			pendingBatchIds: [],
			revision: 1,
			status: `live`,
		})
		expect(serverState.silo.getState(serverState.pathsAtom)).toEqual([
			`committed`,
		])
		expect(clientState.silo.getState(clientState.pathsAtom)).toEqual([
			`committed`,
		])
		expect(serverErrors).toHaveBeenCalled()
		expect(clientErrors).toHaveBeenCalled()
		serverErrors.mockRestore()
		clientErrors.mockRestore()
	})

	test(`storage append reserves every operation ID or none`, async () => {
		const state = await designFixture(`storage-atomicity`)
		const storage = new InMemoryMosaicDomainBatchStorage()
		const firstProposal = proposal(state.domain)
		const first: MosaicDomainBatchEnvelope = {
			...firstProposal,
			actor: `alice`,
		}
		await storage.appendBatch({
			accepted: { batch: first, revision: 1 },
			expectedRevision: 0,
			fingerprint: `first`,
		})
		const second: MosaicDomainBatchEnvelope = {
			...first,
			affectedMembers: [first.affectedMembers[0]],
			dependencies: [first.id],
			id: `batch-2`,
			operations: [
				{ ...first.operations[0], id: `new-operation` },
				{ ...first.operations[0], id: `operation-node` },
			],
		}
		const result = await storage.appendBatch({
			accepted: { batch: second, revision: 2 },
			expectedRevision: 1,
			fingerprint: `second`,
		})
		expect(result).toMatchObject({ collision: `operation`, status: `collision` })
		expect(await storage.receipt(state.domain.identity, `batch-2`)).toBeNull()
		expect((await storage.recover(state.domain.identity)).headRevision).toBe(1)
	})

	test(`rejects invalid in-memory storage revisions and recovery cursors`, async () => {
		const state = await designFixture(`storage-revision-validation`)
		const storage = new InMemoryMosaicDomainBatchStorage()
		const batch: MosaicDomainBatchEnvelope = {
			...proposal(state.domain),
			actor: `alice`,
		}
		expect(() =>
			storage.appendBatch({
				accepted: { batch, revision: 2 },
				expectedRevision: 0,
				fingerprint: `invalid-revision`,
			}),
		).toThrow(`must use revision 1`)
		expect(() => storage.recover(state.domain.identity, -1)).toThrow(
			`must be non-negative`,
		)
	})

	test(`publishes a reusable storage-adapter conformance fixture`, async () => {
		await testMosaicDomainBatchStorageAdapter(
			() => new InMemoryMosaicDomainBatchStorage(),
		)
	})

	test(`bounds proposal work and reports queue backpressure`, async () => {
		const state = await designFixture(`server-limits`)
		let releaseAuthorization: (() => void) | undefined
		const authorization = new Promise<void>((resolve) => {
			releaseAuthorization = resolve
		})
		const server = createMosaicDomainBatchServer({
			authorize: async () => {
				await authorization
				return true
			},
			domain: state.domain,
			limits: { maxBytes: 4_096, maxPendingProposals: 1 },
		})
		const connection = server.connect({ actor: `alice`, session: `session-a` })
		const first = connection.propose(proposal(state.domain))
		const second = await connection.propose(
			proposal(state.domain, { id: `batch-queued` }),
		)
		expect(second).toMatchObject({
			rejection: { code: `backpressure`, recovery: `retry` },
			status: `rejected`,
		})
		releaseAuthorization?.()
		await expect(first).resolves.toMatchObject({ status: `accepted` })

		const oversized = await connection.propose(
			proposal(state.domain, {
				dependencies: [`batch-1`],
				id: `batch-oversized`,
				operations: [
					{
						...proposal(state.domain).operations[0],
						id: `operation-oversized`,
						operation: { path: `x`.repeat(8_192), type: `append` },
					},
				],
				affectedMembers: [proposal(state.domain).affectedMembers[0]],
			}),
		)
		expect(oversized).toMatchObject({
			rejection: { code: `capacity-exceeded` },
			status: `rejected`,
		})
		expect(server.revision).toBe(1)
	})

	test(`fails closed across server configuration, identity, authorization, and disposal boundaries`, async () => {
		const state = await designFixture(`server-failure-boundaries`)
		expect(() =>
			createMosaicDomainBatchServer({
				domain: state.domain,
				limits: { maxPendingProposals: 0 },
			}),
		).toThrow(`maxPendingProposals`)
		expect(() =>
			createMosaicDomainBatchServer({
				domain: state.domain,
				limits: { maxBytes: 0 },
			}),
		).toThrow(`maxBytes`)
		const server = createMosaicDomainBatchServer({ domain: state.domain })
		expect(() => server.connect({ actor: ``, session: `session-a` })).toThrow(
			`actor and session IDs`,
		)
		const connection = server.connect({ actor: `alice`, session: `session-a` })
		await expect(
			connection.propose({
				...proposal(state.domain),
				session: `another-session`,
			}),
		).resolves.toMatchObject({ rejection: { code: `invalid-payload` } })
		await expect(
			connection.propose({
				...proposal(state.domain),
				dependencies: [`missing`],
			}),
		).resolves.toMatchObject({ rejection: { code: `missing-dependency` } })
		await expect(
			connection.propose({
				...proposal(state.domain),
				uncloneable: () => undefined,
			} as never),
		).resolves.toMatchObject({ rejection: { code: `invalid-payload` } })

		const deniedState = await designFixture(`server-authorization-error`)
		const denied = createMosaicDomainBatchServer({
			authorize: () => {
				throw new Error(`authorization unavailable`)
			},
			domain: deniedState.domain,
		})
		await expect(
			denied
				.connect({ actor: `alice`, session: `session-a` })
				.propose(proposal(deniedState.domain)),
		).resolves.toMatchObject({ rejection: { code: `unauthorized` } })

		const observedState = await designFixture(`server-listener-error`)
		const observed = createMosaicDomainBatchServer({
			domain: observedState.domain,
		})
		const observedErrors = vitest
			.spyOn(observedState.silo.store.logger, `error`)
			.mockImplementation(() => undefined)
		observed.connect({ actor: `bob`, session: `session-b` }).subscribe(() => {
			throw new Error(`listener failed`)
		})
		await expect(
			observed
				.connect({ actor: `alice`, session: `session-a` })
				.propose(proposal(observedState.domain)),
		).resolves.toMatchObject({ status: `accepted` })
		expect(observedErrors).toHaveBeenCalled()
		observedErrors.mockRestore()

		const disposingState = await designFixture(`server-disposed-before-append`)
		let releaseAuthorization: (() => void) | undefined
		let signalAuthorization: (() => void) | undefined
		const authorizationStarted = new Promise<void>((resolve) => {
			signalAuthorization = resolve
		})
		const authorization = new Promise<void>((resolve) => {
			releaseAuthorization = resolve
		})
		const disposing = createMosaicDomainBatchServer({
			authorize: async () => {
				signalAuthorization?.()
				await authorization
				return true
			},
			domain: disposingState.domain,
		})
		const disposingConnection = disposing.connect({
			actor: `alice`,
			session: `session-a`,
		})
		const pending = disposingConnection.propose(proposal(disposingState.domain))
		await authorizationStarted
		disposing.dispose()
		releaseAuthorization?.()
		await expect(pending).resolves.toMatchObject({
			rejection: { code: `backpressure`, recovery: `retry` },
		})
		await expect(
			disposingConnection.propose(
				proposal(disposingState.domain, { id: `after-dispose` }),
			),
		).resolves.toMatchObject({ rejection: { code: `backpressure` } })

		const invalidModelState = await designFixture(`server-invalid-model`)
		const invalidModel = createMosaicDomainBatchServer({
			domain: invalidModelState.domain,
		}).connect({ actor: `alice`, session: `session-a` })
		await expect(
			invalidModel.propose({
				...proposal(invalidModelState.domain),
				operations: proposal(invalidModelState.domain).operations.map(
					(operation, index) =>
						index === 0
							? { ...operation, model: { key: `wrong`, version: 1 } }
							: operation,
				),
			}),
		).resolves.toMatchObject({
			rejection: { code: `invalid-model-operation` },
			status: `rejected`,
		})

		const invalidRecovery = async (
			name: string,
			recovery: ReturnType<InMemoryMosaicDomainBatchStorage[`recover`]>,
			error: string,
		) => {
			const invalidState = await designFixture(name)
			const storage: MosaicDomainBatchStorageAdapter = {
				appendBatch: () => {
					throw new Error(`append must not run`)
				},
				receipt: () => null,
				recover: () => recovery,
			}
			const invalidServer = createMosaicDomainBatchServer({
				domain: invalidState.domain,
				storage,
			})
			await expect(
				invalidServer
					.connect({ actor: `alice`, session: `session-a` })
					.propose(proposal(invalidState.domain)),
			).rejects.toThrow(error)
		}
		const recoveryGapState = await designFixture(`server-recovery-gap-envelope`)
		await invalidRecovery(
			`server-recovery-gap`,
			{
				headRevision: 2,
				tail: [
					{
						batch: {
							...proposal(recoveryGapState.domain),
							actor: `alice`,
						},
						revision: 2,
					},
				],
			},
			`revision gap`,
		)
		await invalidRecovery(
			`server-incomplete-recovery`,
			{ headRevision: 1, tail: [] },
			`incomplete recovery tail`,
		)

		const behindState = await designFixture(`server-storage-behind`)
		const behindBacking = new InMemoryMosaicDomainBatchStorage()
		let moveBehind = false
		const behindStorage: MosaicDomainBatchStorageAdapter = {
			appendBatch: (request) => behindBacking.appendBatch(request),
			receipt: (domain, batchId) => behindBacking.receipt(domain, batchId),
			recover: (domain, afterRevision) =>
				moveBehind
					? { headRevision: 0, tail: [] }
					: behindBacking.recover(domain, afterRevision),
		}
		const behindServer = createMosaicDomainBatchServer({
			domain: behindState.domain,
			storage: behindStorage,
		})
		const behindConnection = behindServer.connect({
			actor: `alice`,
			session: `session-a`,
		})
		await expect(
			behindConnection.propose(proposal(behindState.domain)),
		).resolves.toMatchObject({ accepted: { revision: 1 } })
		moveBehind = true
		await expect(
			behindConnection.propose(
				proposal(behindState.domain, {
					id: `after-storage-moved-behind`,
					operations: proposal(behindState.domain).operations.map(
						(operation, index) => ({
							...operation,
							id: `after-storage-moved-behind-operation-${index}`,
						}),
					),
				}),
			),
		).rejects.toThrow(`storage moved behind`)
	})

	test(`synchronizes append races before accepting, retrying, or applying backpressure`, async () => {
		const setup = async (
			name: string,
			mode: `duplicate` | `retry` | `twice-stale`,
		) => {
			const state = await designFixture(name)
			const backing = new InMemoryMosaicDomainBatchStorage()
			const foreign: MosaicDomainBatchEnvelope = {
				...proposal(state.domain, {
					id: `${name}-foreign`,
					operations: proposal(state.domain).operations.map(
						(operation, index) => ({
							...operation,
							id: `${name}-foreign-operation-${index}`,
							operation:
								index === 0
									? { path: `${name}-foreign`, type: `append` }
									: { type: `move`, x: 1, y: 2 },
						}),
					),
				}),
				actor: `bob`,
			}
			let appendCount = 0
			const storage: MosaicDomainBatchStorageAdapter = {
				appendBatch(request: MosaicDomainBatchAppendRequest) {
					appendCount++
					if (mode === `duplicate`) {
						const committed = backing.appendBatch(request)
						if (committed.status !== `accepted`) {
							throw new Error(`The duplicate-race fixture failed to commit.`)
						}
						return { accepted: committed.accepted, status: `duplicate` }
					}
					if (appendCount === 1) {
						const committed = backing.appendBatch({
							accepted: { batch: foreign, revision: 1 },
							expectedRevision: 0,
							fingerprint: `${name}-foreign-fingerprint`,
						})
						if (committed.status !== `accepted`) {
							throw new Error(`The stale-race fixture failed to commit.`)
						}
						return { actualRevision: 1, status: `stale` }
					}
					return mode === `twice-stale`
						? { actualRevision: 1, status: `stale` }
						: backing.appendBatch(request)
				},
				receipt: (domain, batchId) => backing.receipt(domain, batchId),
				recover: (domain, afterRevision) =>
					backing.recover(domain, afterRevision),
			}
			return { state, storage }
		}

		const duplicate = await setup(`server-duplicate-append`, `duplicate`)
		const duplicateServer = createMosaicDomainBatchServer({
			domain: duplicate.state.domain,
			storage: duplicate.storage,
		})
		await expect(
			duplicateServer
				.connect({ actor: `alice`, session: `session-a` })
				.propose(proposal(duplicate.state.domain)),
		).resolves.toMatchObject({ accepted: { revision: 1 }, status: `accepted` })
		expect(duplicateServer.revision).toBe(1)
		expect(duplicate.state.silo.getState(duplicate.state.pathsAtom)).toEqual([
			`p1`,
		])

		const retry = await setup(`server-stale-retry`, `retry`)
		const retryServer = createMosaicDomainBatchServer({
			domain: retry.state.domain,
			storage: retry.storage,
		})
		await expect(
			retryServer
				.connect({ actor: `alice`, session: `session-a` })
				.propose(proposal(retry.state.domain)),
		).resolves.toMatchObject({ accepted: { revision: 2 }, status: `accepted` })
		expect(retryServer.revision).toBe(2)
		expect(retry.state.silo.getState(retry.state.pathsAtom)).toEqual([
			`server-stale-retry-foreign`,
			`p1`,
		])

		const twiceStale = await setup(`server-twice-stale`, `twice-stale`)
		const twiceStaleServer = createMosaicDomainBatchServer({
			domain: twiceStale.state.domain,
			storage: twiceStale.storage,
		})
		await expect(
			twiceStaleServer
				.connect({ actor: `alice`, session: `session-a` })
				.propose(proposal(twiceStale.state.domain)),
		).resolves.toMatchObject({
			rejection: { code: `backpressure`, recovery: `retry` },
			status: `rejected`,
		})
		expect(twiceStaleServer.revision).toBe(1)
		expect(twiceStale.state.silo.getState(twiceStale.state.pathsAtom)).toEqual([
			`server-twice-stale-foreign`,
		])
	})

	test(`snapshots queued proposals before callers can mutate them`, async () => {
		const state = await designFixture(`server-queued-snapshot`)
		let releaseAuthorization: (() => void) | undefined
		const authorization = new Promise<void>((resolve) => {
			releaseAuthorization = resolve
		})
		let authorizations = 0
		const server = createMosaicDomainBatchServer({
			authorize: async () => {
				if (authorizations++ === 0) await authorization
				return true
			},
			domain: state.domain,
		})
		const connection = server.connect({ actor: `alice`, session: `session-a` })
		const first = connection.propose(proposal(state.domain))
		const pathAddress = state.domain.address(`paths`)
		const second = proposal(state.domain, {
			affectedMembers: [pathAddress],
			dependencies: [`batch-1`],
			id: `batch-2`,
			operations: [
				{
					address: pathAddress,
					id: `operation-2`,
					model: mosaicDomainMemberModelIdentity(pathModel),
					operation: { path: `before-mutation`, type: `append` },
				},
			],
		})
		const queued = connection.propose(second)
		;(second.operations[0].operation as { path: string }).path = `after-mutation`
		releaseAuthorization?.()

		await expect(first).resolves.toMatchObject({ status: `accepted` })
		await expect(queued).resolves.toMatchObject({ status: `accepted` })
		expect(state.silo.getState(state.pathsAtom)).toEqual([
			`p1`,
			`before-mutation`,
		])
	})

	test(`rejects malformed runtime proposals without entering the queue`, async () => {
		const state = await designFixture(`server-malformed`)
		const server = createMosaicDomainBatchServer({ domain: state.domain })
		const connection = server.connect({ actor: `alice`, session: `session-a` })

		await expect(connection.propose(null as never)).resolves.toMatchObject({
			rejection: { batchId: null, code: `invalid-payload` },
			status: `rejected`,
		})
		expect(server.revision).toBe(0)
	})

	test(`restarts from one contiguous batch tail without splitting members`, async () => {
		const firstState = await designFixture(`server-before-restart`)
		const storage = new InMemoryMosaicDomainBatchStorage()
		const firstServer = createMosaicDomainBatchServer({
			domain: firstState.domain,
			storage,
		})
		await firstServer
			.connect({ actor: `alice`, session: `session-a` })
			.propose(proposal(firstState.domain))
		firstServer.dispose()

		const restartedState = await designFixture(`server-after-restart`)
		const restarted = createMosaicDomainBatchServer({
			domain: restartedState.domain,
			storage,
		})
		await restarted.connect({ actor: `bob`, session: `session-b` }).recover(0)
		expect(restarted.revision).toBe(1)
		expect(restartedState.silo.getState(restartedState.summarySelector)).toEqual(
			{
				node: { x: 10, y: 20 },
				paths: [`p1`],
			},
		)
	})
})
