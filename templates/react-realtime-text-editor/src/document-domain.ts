import type { Silo } from "atom.io"
import { atom, atomFamily, mutableAtom } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import {
	createEmptyMosaicText,
	mosaicDomain,
	type MosaicDomainValueModel,
	type MosaicTextIndexMember,
	type MosaicTextIndexRoot,
	type MosaicTextOperation,
	type MosaicTextSelection,
	type MosaicTextSnapshot,
	mosaicText,
} from "atom.io/realtime"
import { z } from "zod"

export const MarkdownText = mosaicText({
	maximumDeletionIntervalsPerOperation: 16_384,
	maximumHistoryTargets: 10_000,
	maximumRunGraphemes: 65_536,
	maximumRunUtf16Units: 1_000_000,
	maximumRunsPerOperation: 65_536,
})

const id = z.string().min(1).max(512)
const boundary = z
	.object({ offset: z.number().int().nonnegative(), runId: id })
	.strict()

export const markdownTextOperationSchema: z.ZodType<MosaicTextOperation> =
	z.discriminatedUnion(`type`, [
		z
			.object({
				deleted: z
					.array(
						z
							.object({
								end: z.number().int().positive(),
								runId: id,
								start: z.number().int().nonnegative(),
							})
							.strict(),
					)
					.max(16_384),
				inserted: z
					.array(
						z
							.object({
								after: boundary.nullable(),
								before: boundary.nullable(),
								id,
								text: z.string().min(1).max(1_000_000),
							})
							.strict(),
					)
					.max(65_536),
				type: z.literal(`edit`),
			})
			.strict(),
		z
			.object({
				mode: z.enum([`redo`, `undo`]),
				targetOperationIds: z.array(id).min(1).max(10_000),
				type: z.literal(`history`),
			})
			.strict(),
	])

export type MarkdownIndexOperation<Value> = {
	readonly type: `set`
	readonly value: Value
}

const indexSummarySchema = z
	.object({
		graphemes: z.number().int().nonnegative(),
		leafCount: z.number().int().nonnegative(),
		lineBreaks: z.number().int().nonnegative(),
		utf16Units: z.number().int().nonnegative(),
	})
	.strict()
const indexReferenceSchema = z
	.object({ id, kind: z.enum([`leaf`, `node`]), summary: indexSummarySchema })
	.strict()
const indexRecoverySchema = z
	.object({
		code: z.literal(`range-resnapshot`),
		range: z
			.object({
				end: z.number().int().nonnegative(),
				kind: z.literal(`utf16-range`),
				start: z.number().int().nonnegative(),
			})
			.strict(),
		reason: z.enum([`alias-fanout`, `alias-missing`, `range-member-limit`]),
	})
	.strict()
const markdownIndexMemberSchema: z.ZodType<MosaicTextIndexMember> =
	z.discriminatedUnion(`kind`, [
		z
			.object({
				fragments: z
					.array(
						z
							.object({
								runId: id,
								start: z.number().int().nonnegative(),
								text: z.string().min(1).max(65_536),
							})
							.strict(),
					)
					.max(64),
				id,
				kind: z.literal(`leaf`),
				summary: indexSummarySchema,
				version: z.literal(1),
			})
			.strict(),
		z
			.object({
				children: z.array(indexReferenceSchema).max(32),
				id,
				kind: z.literal(`node`),
				level: z.number().int().positive(),
				summary: indexSummarySchema,
				version: z.literal(1),
			})
			.strict(),
		z
			.object({
				generation: z.number().int().nonnegative(),
				id,
				kind: z.literal(`alias`),
				recovery: indexRecoverySchema.optional(),
				source: id,
				targets: z.array(id).max(8).optional(),
				version: z.literal(1),
			})
			.strict(),
	])
const markdownIndexRootSchema: z.ZodType<MosaicTextIndexRoot> = z
	.object({
		generation: z.number().int().nonnegative(),
		id: z.literal(`root`),
		kind: z.literal(`root`),
		reference: indexReferenceSchema.nullable(),
		version: z.literal(1),
	})
	.strict()

const historyFreeSetModel = <Value extends Json.Serializable>(
	key: string,
	valueSchema: z.ZodType<Value>,
) =>
	({
		history: {
			classify: () => ({ kind: `exclude` as const }),
			compensate: () => {
				throw new Error(`Index maintenance never enters actor history.`)
			},
		},
		identity: { key, version: 1 },
		kind: `value`,
		operationSchema: z
			.object({ type: z.literal(`set`), value: valueSchema })
			.strict(),
		reduce: (_value, operation) => operation.value,
	}) satisfies MosaicDomainValueModel<
		Value,
		MarkdownIndexOperation<Value> & Json.Serializable
	>

export const markdownIndexMemberModel = historyFreeSetModel(
	`markdown-index-member`,
	markdownIndexMemberSchema,
)
export const markdownIndexRootModel = historyFreeSetModel(
	`markdown-index-root`,
	markdownIndexRootSchema,
)
export const markdownSourceModel = {
	class: MarkdownText,
	kind: `transceiver`,
	operationSchema: markdownTextOperationSchema,
} as const

export const EMPTY_MARKDOWN_INDEX_ROOT: MosaicTextIndexRoot = Object.freeze({
	generation: 0,
	id: `root`,
	kind: `root`,
	reference: null,
	version: 1,
})

const emptyIndexMember = (memberId: string): MosaicTextIndexMember => ({
	fragments: [],
	id: memberId,
	kind: `leaf`,
	summary: {
		graphemes: 0,
		leafCount: 1,
		lineBreaks: 0,
		utf16Units: 0,
	},
	version: 1,
})

export const markdownSourceAtom = mutableAtom<InstanceType<typeof MarkdownText>>(
	{
		class: MarkdownText,
		key: `markdownSource`,
	},
)
export const markdownIndexRootAtom = atom<MosaicTextIndexRoot>({
	default: EMPTY_MARKDOWN_INDEX_ROOT,
	key: `markdownIndexRoot`,
})
export const markdownIndexMemberAtoms = atomFamily<
	MosaicTextIndexMember,
	string
>({
	default: emptyIndexMember,
	key: `markdownIndexMember`,
})

export type MarkdownPresence = {
	readonly actor: string
	readonly color: string
	readonly name: string
	readonly selection: MosaicTextSelection | null
	readonly session: string
	readonly viewport: {
		readonly anchor: MosaicTextSelection[`anchor`]
		readonly head: MosaicTextSelection[`head`]
	} | null
}

const relativePosition = z
	.object({
		affinity: z.enum([`left`, `right`]),
		offset: z.number().int().nonnegative(),
		runId: id.nullable(),
	})
	.strict()

export const markdownPresenceSchema: z.ZodType<MarkdownPresence> = z
	.object({
		actor: id,
		color: z.string().min(1).max(64),
		name: z.string().min(1).max(128),
		selection: z
			.object({ anchor: relativePosition, head: relativePosition })
			.strict()
			.nullable(),
		session: id,
		viewport: z
			.object({ anchor: relativePosition, head: relativePosition })
			.strict()
			.nullable(),
	})
	.strict()

export const markdownPresenceAtoms = atomFamily<MarkdownPresence | null, string>(
	{ default: null, key: `markdownPresence` },
)

export const markdownLocalSelectionAtom = atom<MosaicTextSelection | null>({
	default: null,
	key: `markdownLocalSelection`,
})

export const markdownPresenceKey = (
	identity: Pick<MarkdownPresence, `actor` | `session`>,
): string => `${identity.actor}\u0000${identity.session}`

export const markdownDocumentDomain = mosaicDomain({
	configSchema: z.object({}).strict(),
	key: `markdown-document`,
	members: {
		collaborator: {
			keySchema: id,
			role: `ephemeral`,
			schema: markdownPresenceSchema,
			token: markdownPresenceAtoms,
		},
		indexMembers: {
			keySchema: id,
			model: markdownIndexMemberModel,
			role: `durable`,
			// The Domain declaration conditional distributes the member union. The
			// concrete discriminated validator remains the runtime boundary.
			schema: markdownIndexMemberSchema as never,
			token: markdownIndexMemberAtoms,
		},
		indexRoot: {
			model: markdownIndexRootModel,
			role: `durable`,
			schema: markdownIndexRootSchema,
			token: markdownIndexRootAtom,
		},
		localSelection: { role: `local`, token: markdownLocalSelectionAtom },
		source: {
			model: markdownSourceModel,
			role: `durable`,
			schema: z.custom<MosaicTextSnapshot>(),
			token: markdownSourceAtom,
		},
	},
	version: 1,
})

export const MARKDOWN_DOMAIN_TOKENS = [
	markdownSourceAtom,
	markdownIndexRootAtom,
	markdownIndexMemberAtoms,
	markdownPresenceAtoms,
	markdownLocalSelectionAtom,
] as const

export async function activateMarkdownDocumentDomain(options: {
	readonly instance?: string
	readonly silo: Pick<Silo, `install` | `store`>
}) {
	options.silo.install([...MARKDOWN_DOMAIN_TOKENS])
	return markdownDocumentDomain.activate({
		config: {},
		instance: options.instance ?? `shared-markdown`,
		store: options.silo.store,
	})
}

export type MarkdownDocumentDomain = Awaited<
	ReturnType<typeof activateMarkdownDocumentDomain>
>

export const emptyMarkdownTextSnapshot = (): MosaicTextSnapshot =>
	createEmptyMosaicText()
