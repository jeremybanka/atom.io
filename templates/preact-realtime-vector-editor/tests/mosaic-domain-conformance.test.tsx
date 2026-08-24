import { selector } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import { testMosaicDomainConformance } from "atom.io/realtime-testing"
import type { MosaicDomainMemberAddress } from "atom.io/realtime"

import {
	EMPTY_MARKDOWN_INDEX_ROOT,
	activateMarkdownDocumentDomain,
	markdownIndexMemberAtoms,
	markdownIndexRootAtom,
	markdownSourceAtom,
} from "../../react-realtime-text-editor/src/document-domain.ts"
import { readSvgRegister } from "@atom.io/template-preact-svg-editor/convergence"
import { activateSvgDesignDomain } from "@atom.io/template-preact-svg-editor/domain"
import { edgeAtoms, nodeAtoms } from "@atom.io/template-preact-svg-editor/model"
import {
	createMosaicDomainVerticalConformanceAdapter,
	type MosaicDomainVerticalConformanceConfig,
} from "./mosaic-domain-conformance-fixture.ts"

type FixtureClient = Parameters<
	MosaicDomainVerticalConformanceConfig[`change`]
>[0]

const textProjectionSelector = selector<string>({
	get: ({ get }) => get(markdownSourceAtom).text,
	key: `textProjection`,
})

const vectorProjectionSelector = selector<Json.Serializable>({
	get: ({ get }) => [
		readSvgRegister(get(nodeAtoms, `node-0`)) ?? null,
		readSvgRegister(get(nodeAtoms, `node-1`)) ?? null,
		readSvgRegister(get(edgeAtoms, `node-0`)) ?? null,
	],
	key: `vectorProjection`,
})

const textMember = (id: string) => ({
	fragments: [],
	id,
	kind: `leaf` as const,
	summary: {
		graphemes: 0,
		leafCount: 1,
		lineBreaks: 0,
		utf16Units: 0,
	},
	version: 1 as const,
})

const textEdit = (
	client: FixtureClient,
	id: string,
	options: { readonly segments?: number; readonly text: string },
) => {
	const source = client.silo.getState(markdownSourceAtom)
	const position = source.positionAtOffset(source.length)
	const after =
		position.runId === null
			? null
			: { offset: position.offset, runId: position.runId }
	const segments = options.segments ?? 1
	let insertionAfter = after
	const operation = {
		deleted: [],
		inserted: Array.from({ length: segments }, (_, index) => {
			const text = `${options.text}${segments === 1 ? `` : index}`
			const run = {
				after: insertionAfter,
				before: null,
				id: `${id}:run:${index.toString().padStart(6, `0`)}`,
				text,
			}
			insertionAfter = { offset: [...text].length, runId: run.id }
			return run
		}),
		type: `edit` as const,
	}
	return {
		logicalOperationCount: operation.inserted.length,
		operations: [
			{
				address: domainAddress(client.domain, `source`),
				id,
				operation,
			},
		],
	}
}

const domainAddress = (
	domain: FixtureClient[`domain`],
	member: string,
	key?: string,
): MosaicDomainMemberAddress => {
	const address = domain.address as (
		member: string,
		key?: string,
	) => MosaicDomainMemberAddress
	return key === undefined ? address(member) : address(member, key)
}

const textConfig = {
	async activate(silo) {
		const domain = await activateMarkdownDocumentDomain({
			instance: `mosaic-conformance`,
			silo,
		})
		silo.install([textProjectionSelector])
		return domain
	},
	addresses(domain) {
		return [
			domainAddress(domain, `indexMembers`, `member-0`),
			domainAddress(domain, `indexMembers`, `member-1`),
			domainAddress(domain, `indexMembers`, `member-2`),
			domainAddress(domain, `indexMembers`, `member-3`),
			domainAddress(domain, `indexRoot`),
			domainAddress(domain, `source`),
		]
	},
	atomic(client, sequence) {
		return textEdit(client, `text:atomic:${sequence}`, {
			segments: 2,
			text: `XY`,
		})
	},
	change(client, label, sequence) {
		return textEdit(client, `text:${label}:${sequence}`, {
			text: `[${label}]`,
		})
	},
	foreignProjection(client) {
		return client.silo
			.getState(markdownSourceAtom)
			.text.includes(`[history-foreign]`)
	},
	async initialize(client, sequence) {
		const first = textEdit(client, `text:seed-a:${sequence}`, {
			text: `AB`,
		})
		await client.batch.submit(first.operations, `text:seed-a`)
		const second = textEdit(client, `text:seed-b:${sequence}`, { text: `CD` })
		await client.batch.submit(second.operations, `text:seed-b`)
		await client.batch.submit(
			[
				{
					address: domainAddress(client.domain, `indexRoot`),
					operation: { type: `set`, value: EMPTY_MARKDOWN_INDEX_ROOT },
				},
				...Array.from({ length: 4 }, (_, index) => ({
					address: domainAddress(
						client.domain,
						`indexMembers`,
						`member-${index}`,
					),
					operation: { type: `set`, value: textMember(`member-${index}`) },
				})),
			],
			`text:index-seed`,
		)
	},
	name: `text`,
	ownProjection(client) {
		return client.silo
			.getState(markdownSourceAtom)
			.text.includes(`[history-own]`)
	},
	presence(client) {
		return {
			address: domainAddress(
				client.domain,
				`collaborator`,
				`${client.actor}\u0000${client.session}`,
			),
			value: {
				actor: client.actor,
				color: `#7057ff`,
				name: client.actor,
				selection: null,
				session: client.session,
				viewport: null,
			},
		}
	},
	projection({ silo }) {
		return {
			members: Array.from({ length: 4 }, (_, index) =>
				silo.getState(markdownIndexMemberAtoms, `member-${index}`),
			),
			root: silo.getState(markdownIndexRootAtom),
			text: silo.getState(markdownSourceAtom).text,
		}
	},
	selector: textProjectionSelector,
} satisfies MosaicDomainVerticalConformanceConfig

const vectorOperation = (
	client: FixtureClient,
	member: `edges` | `nodes`,
	key: string,
	sequence: number,
	value: Json.Serializable,
) => {
	const id = `${sequence.toString().padStart(16, `0`)}:${client.actor}:${member}:${key}`
	return {
		address: client.domain.address(member, key),
		id,
		operation: { actor: client.actor, id, value },
	}
}

const vectorConfig = {
	async activate(silo) {
		const domain = await activateSvgDesignDomain({
			instance: `mosaic-conformance`,
			silo,
		})
		silo.install([vectorProjectionSelector])
		return domain
	},
	addresses(domain) {
		return Array.from({ length: 7 }, (_, index) => [
			domain.address(`nodes`, `node-${index}`),
			domain.address(`edges`, `node-${index}`),
		]).flat()
	},
	atomic(client, sequence) {
		return {
			logicalOperationCount: 2,
			operations: [
				vectorOperation(client, `nodes`, `node-0`, sequence, {
					x: sequence,
					y: sequence + 1,
				}),
				vectorOperation(client, `edges`, `node-0`, sequence, {
					kind: `line`,
				}),
			],
		}
	},
	change(client, label, sequence) {
		const key =
			label === `history-own`
				? `node-1`
				: label === `history-foreign`
					? `node-2`
					: `node-${3 + (sequence % 4)}`
		return {
			logicalOperationCount: 2,
			operations: [
				vectorOperation(client, `nodes`, key, sequence, {
					x: sequence,
					y: sequence * 2,
				}),
				vectorOperation(client, `edges`, key, sequence, {
					kind: `line`,
				}),
			],
		}
	},
	foreignProjection(client) {
		return readSvgRegister(client.silo.getState(nodeAtoms, `node-2`)) ?? null
	},
	async initialize(client, sequence) {
		const operations = Array.from({ length: 7 }, (_, index) => [
			vectorOperation(client, `nodes`, `node-${index}`, sequence, {
				x: index,
				y: index,
			}),
			vectorOperation(client, `edges`, `node-${index}`, sequence, {
				kind: `line`,
			}),
		]).flat()
		await client.batch.submit(operations, `vector:seed`)
	},
	name: `vector`,
	ownProjection(client) {
		return readSvgRegister(client.silo.getState(nodeAtoms, `node-1`)) ?? null
	},
	presence(client) {
		return {
			address: client.domain.address(
				`collaborator`,
				`${client.actor}\u0000${client.session}`,
			),
			value: {
				activePathId: null,
				actor: client.actor,
				color: `#7057ff`,
				name: client.actor,
				pointer: null,
				selectedSubpathId: null,
				session: client.session,
			},
		}
	},
	projection({ silo }) {
		return Array.from({ length: 7 }, (_, index) => ({
			edge: readSvgRegister(silo.getState(edgeAtoms, `node-${index}`)) ?? null,
			node: readSvgRegister(silo.getState(nodeAtoms, `node-${index}`)) ?? null,
		}))
	},
	selector: vectorProjectionSelector,
} satisfies MosaicDomainVerticalConformanceConfig

describe(`cross-vertical Mosaic Domain conformance`, () => {
	test.each([
		[`text`, textConfig],
		[`vector`, vectorConfig],
	] as const)(
		`runs the identical fault schedule for %s`,
		async (_name, config) => {
			const adapter = await createMosaicDomainVerticalConformanceAdapter(config)
			try {
				const report = await testMosaicDomainConformance(adapter)
				expect(report.schedule).toEqual([
					`duplicate`,
					`delay`,
					`reorder`,
					`reject`,
					`disconnect`,
					`restart`,
					`resnapshot`,
				])
				expect(report.counters).toMatchObject({
					checkpointWrites: 2,
					residentMembers: 4,
					selectorInvalidations: 1,
				})
				expect(report.counters.deliveredPayloads).toBeGreaterThan(0)
				expect(report.counters.retainedHistory).toBeGreaterThan(0)
			} finally {
				await adapter[Symbol.dispose]()
			}
		},
	)
})
