import type { Silo } from "atom.io"
import { atom, atomFamily, mutableAtom } from "atom.io"
import {
	createMosaicTextDomainModels,
	mosaicDomain,
	mosaicText,
	type MosaicTextIndexMember,
	type MosaicTextIndexRoot,
	type MosaicTextSelection,
} from "atom.io/realtime"
import { z } from "zod"

export const MARKDOWN_INDEX_OPTIONS = {
	maximumAliasGenerations: 4,
	maximumAliasTargets: 8,
	maximumChildrenPerNode: 32,
	maximumFragmentsPerLeaf: 64,
	maximumLeafGraphemes: 65_536,
	maximumLeafUtf16Units: 65_536,
	minimumChildrenPerNode: 8,
	minimumLeafGraphemes: 16_384,
	targetChildrenPerNode: 16,
	targetLeafGraphemes: 32_768,
} as const

export const MarkdownText = mosaicText({
	maximumDeletionIntervalsPerOperation: 16_384,
	maximumHistoryTargets: 10_000,
	maximumRunGraphemes: 65_536,
	maximumRunUtf16Units: 1_000_000,
	maximumRunsPerOperation: 65_536,
})

export const {
	emptyIndexRoot: EMPTY_MARKDOWN_INDEX_ROOT,
	indexMemberModel: markdownIndexMemberModel,
	indexMemberSchema: markdownIndexMemberSchema,
	indexRootModel: markdownIndexRootModel,
	indexRootSchema: markdownIndexRootSchema,
	sourceModel: markdownSourceModel,
	sourceSnapshotSchema: markdownSourceSnapshotSchema,
} = createMosaicTextDomainModels({
	index: MARKDOWN_INDEX_OPTIONS,
	text: MarkdownText,
})

const id = z.string().min(1).max(512)
const emptyIndexMember = (memberId: string): MosaicTextIndexMember => ({
	fragments: [],
	id: memberId,
	kind: `leaf`,
	summary: { graphemes: 0, leafCount: 1, lineBreaks: 0, utf16Units: 0 },
	version: 1,
})

export const markdownSourceAtom = mutableAtom<InstanceType<typeof MarkdownText>>(
	{ class: MarkdownText, key: `markdownSource` },
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
			schema: markdownIndexMemberSchema as never,
			token: markdownIndexMemberAtoms,
		},
		indexRoot: {
			model: markdownIndexRootModel,
			role: `durable`,
			schema: markdownIndexRootSchema,
			token: markdownIndexRootAtom,
		},
		source: {
			model: markdownSourceModel,
			role: `durable`,
			schema: markdownSourceSnapshotSchema,
			token: markdownSourceAtom,
		},
	},
	version: 1,
})

const MARKDOWN_DOMAIN_TOKENS = [
	markdownSourceAtom,
	markdownIndexRootAtom,
	markdownIndexMemberAtoms,
	markdownPresenceAtoms,
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
