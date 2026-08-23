import { atom, atomFamily, mutableAtom, Silo } from "atom.io"
import {
	createMosaicTextDomainModels,
	createMosaicTextIndex,
	mosaicDomain,
	mosaicText,
	type MosaicTextIndexMember,
	type MosaicTextIndexRoot,
} from "atom.io/realtime"
import {
	createMosaicDomainBatchServer,
	createMosaicTextDocumentCoordinator,
	prepareMosaicTextImportOperation,
} from "atom.io/realtime-server"
import { z } from "zod"

const indexOptions = {
	maximumAliasGenerations: 2,
	maximumAliasTargets: 4,
	maximumChildrenPerNode: 4,
	maximumFragmentsPerLeaf: 4,
	maximumLeafGraphemes: 12,
	maximumLeafUtf16Units: 32,
	minimumChildrenPerNode: 2,
	minimumLeafGraphemes: 2,
	targetChildrenPerNode: 3,
	targetLeafGraphemes: 6,
} as const

const Text = mosaicText({
	maximumDeletionIntervalsPerOperation: 32,
	maximumHistoryTargets: 32,
	maximumRunGraphemes: 16,
	maximumRunUtf16Units: 64,
	maximumRunsPerOperation: 32,
})

const models = createMosaicTextDomainModels({ index: indexOptions, text: Text })

const validate = (schema: any, value: unknown): any =>
	schema[`~standard`].validate(value)

async function fixture(allowImport = true) {
	const silo = new Silo({
		isProduction: false,
		lifespan: `ephemeral`,
		name: `mosaic-text-document`,
	})
	const sourceAtom = mutableAtom<InstanceType<typeof Text>>({
		class: Text,
		key: `source`,
	})
	const rootAtom = atom<MosaicTextIndexRoot>({
		default: models.emptyIndexRoot,
		key: `root`,
	})
	const memberAtoms = atomFamily<MosaicTextIndexMember, string>({
		default: (id) => ({
			fragments: [],
			id,
			kind: `leaf`,
			summary: { graphemes: 0, leafCount: 1, lineBreaks: 0, utf16Units: 0 },
			version: 1,
		}),
		key: `member`,
	})
	const definition = mosaicDomain({
		configSchema: z.object({}),
		key: `text-document-test`,
		members: {
			index: {
				keySchema: z.string(),
				model: models.indexMemberModel,
				role: `durable`,
				schema: models.indexMemberSchema as never,
				token: memberAtoms,
			},
			root: {
				model: models.indexRootModel,
				role: `durable`,
				schema: models.indexRootSchema,
				token: rootAtom,
			},
			source: {
				model: models.sourceModel,
				role: `durable`,
				schema: models.sourceSnapshotSchema,
				token: sourceAtom,
			},
		},
		version: 1,
	})
	silo.install([sourceAtom, rootAtom, memberAtoms])
	const domain = await definition.activate({
		config: {},
		instance: `document`,
		store: silo.store,
	})
	const batches = createMosaicDomainBatchServer({ domain })
	const document = await createMosaicTextDocumentCoordinator({
		authorizeImport: () => allowImport,
		batches,
		domain,
		import: {
			maximumRunGraphemes: 16,
			maximumRunUtf16Units: 64,
		},
		index: {
			memberAddress: (id) => domain.address(`index`, id),
			memberModel: models.indexMemberModel,
			options: indexOptions,
			rootAddress: domain.address(`root`),
			rootModel: models.indexRootModel,
		},
		source: {
			address: domain.address(`source`),
			model: models.sourceModel,
			read: () => silo.getState(sourceAtom) as InstanceType<typeof Text>,
		},
	})
	return { batches, document }
}

describe(`Mosaic text Domain models and document coordinator`, () => {
	test(`publishes one atomic import and bounded indexed replacement`, async () => {
		const { batches, document } = await fixture()
		const source = `Alpha 👩🏽‍💻\nBeta gamma\nDelta epsilon`
		const imported = await document.submit({
			actor: `ada`,
			command: {
				gestureId: `import`,
				sequence: 1,
				text: source,
				type: `import`,
			},
			session: `tab`,
		})
		expect(imported.revision).toBe(1)
		expect(document.materialize()).toBe(source)
		expect(document.length).toBe(source.length)
		expect(document.indexSummary).toMatchObject({ utf16Units: source.length })

		const start = await document.positionAtOffset(source.indexOf(`gamma`))
		const end = await document.positionAtOffset(source.indexOf(`gamma`) + 5)
		await document.submit({
			actor: `ada`,
			command: {
				gestureId: `replace`,
				selection: { anchor: start.position, head: end.position },
				sequence: 2,
				text: `Γ`,
				type: `replace`,
			},
			session: `tab`,
		})
		const expected = source.replace(`gamma`, `Γ`)
		expect(document.materialize()).toBe(expected)
		expect(document.resolvePosition(start.position)).toBeLessThanOrEqual(
			expected.length,
		)
		const range = {
			end: expected.length,
			kind: `utf16-range` as const,
			start: 0,
		}
		const inspection = await document.inspectRange(range, 32)
		expect(inspection.projectionText).toBe(expected)
		expect(inspection.residentMemberCount).toBeGreaterThan(1)
		await expect(document.resolveRange(range, 32)).resolves.toHaveLength(
			inspection.leafIds.length,
		)
		expect(document.instrumentation).toMatchObject({ batches: 2 })
		expect(document.instrumentation.lastBatchOperations).toBeGreaterThan(1)
		expect(document.instrumentation.materializations).toBe(2)

		document[Symbol.dispose]()
		document[Symbol.dispose]()
		await expect(
			document.submit({
				actor: `ada`,
				command: {
					gestureId: `late`,
					sequence: 3,
					text: `late`,
					type: `import`,
				},
				session: `tab`,
			}),
		).rejects.toThrow(`disposed`)
	})

	test(`requires explicit import authorization and rejects no-op edits`, async () => {
		const denied = await fixture(false)
		await expect(
			denied.document.submit({
				actor: `mallory`,
				command: {
					gestureId: `denied`,
					sequence: 1,
					text: `secret`,
					type: `import`,
				},
				session: `tab`,
			}),
		).rejects.toThrow(`not authorized`)
		const absentPolicy = await fixture()
		const input = {
			actor: `ada`,
			command: {
				gestureId: `empty`,
				sequence: 1,
				text: ``,
				type: `import` as const,
			},
			session: `tab`,
		}
		await expect(absentPolicy.document.submit(input)).rejects.toThrow(
			`no change`,
		)
	})

	test(`normalizes bounded schemas and streaming import runs`, () => {
		const index = createMosaicTextIndex(
			[{ runId: `run`, start: 0, text: `alpha` }],
			indexOptions,
		)
		for (const member of index.members) {
			expect(validate(models.indexMemberSchema, member)).toMatchObject({
				value: member,
			})
		}
		expect(validate(models.indexRootSchema, index.root)).toMatchObject({
			value: index.root,
		})
		expect(
			validate(models.indexMemberSchema, {
				...index.members[0],
				fragments: [{ runId: `run`, start: 0, text: `x`.repeat(33) }],
			}),
		).toHaveProperty(`issues`)
		expect(
			validate(models.indexRootSchema, { ...index.root, extra: true }),
		).toHaveProperty(`issues`)
		expect(
			validate(models.sourceModel.operationSchema, {
				deleted: [],
				inserted: [
					{ after: null, before: null, id: `run`, text: `x`.repeat(65) },
				],
				type: `edit`,
			}),
		).toHaveProperty(`issues`)

		const text = new Text()
		const operation = prepareMosaicTextImportOperation(
			text,
			`A👩🏽‍💻BCDEF`,
			`import`,
			{ maximumRunGraphemes: 2, maximumRunUtf16Units: 16 },
		)
		expect(operation.type).toBe(`edit`)
		if (operation.type === `edit`) {
			expect(operation.inserted.map(({ text: value }) => value).join(``)).toBe(
				`A👩🏽‍💻BCDEF`,
			)
			expect(operation.inserted.length).toBeGreaterThan(1)
		}
		for (const options of [
			{ maximumRunGraphemes: 0 },
			{ maximumRunUtf16Units: 0 },
		]) {
			expect(() =>
				prepareMosaicTextImportOperation(text, `x`, `invalid`, options),
			).toThrow(`positive safe integers`)
		}
		expect(() =>
			prepareMosaicTextImportOperation(text, `👩🏽‍💻`, `small`, {
				maximumRunUtf16Units: 1,
			}),
		).toThrow(`grapheme exceeds`)
	})
})
