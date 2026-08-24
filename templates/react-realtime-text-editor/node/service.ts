import { Silo } from "atom.io"
import {
	type MosaicAcceptedDomainBatchEnvelope,
	type MosaicTextIndexLookup,
	type MosaicTextIndexRange,
	type MosaicTextIndexSummary,
	type MosaicTextRelativePosition,
	type MosaicTextSnapshot,
} from "atom.io/realtime"
import {
	bindMosaicDomainHistoryServerSocket,
	bindMosaicDomainPresenceServerSocket,
	bindMosaicDomainResidencyServerSocket,
	createMosaicDomainBatchServer,
	createMosaicDomainHistoryCoordinator,
	createMosaicDomainPresenceServer,
	createMosaicDomainResidencyServer,
	createMosaicTextDocumentCoordinator,
	InMemoryMosaicDomainCheckpointStorage,
	type MosaicDomainCheckpointStorageAdapter,
	type MosaicDomainHistoryConnection,
	type MosaicTextDocumentInstrumentation,
	type MosaicTextDocumentRangeInspection,
} from "atom.io/realtime-server"
import type { Socket } from "socket.io"
import { z } from "zod"

import {
	activateMarkdownDocumentDomain,
	MARKDOWN_INDEX_OPTIONS,
	markdownIndexMemberModel,
	markdownIndexRootModel,
	markdownSourceAtom,
	markdownSourceModel,
	type MarkdownDocumentDomain,
	type MarkdownText,
} from "../src/document-domain.ts"
import { INITIAL_MARKDOWN } from "../src/initial-markdown.ts"
import {
	MARKDOWN_EVENTS,
	type MarkdownAcknowledgement,
	type MarkdownCommand,
} from "../src/protocol.ts"

export type MarkdownDocumentInstrumentation =
	MosaicTextDocumentInstrumentation & {
		readonly activeFullDocumentModels: 1
		readonly maximumFullDocumentModels: 1
	}

export type MarkdownDocumentRangeInspection = MosaicTextDocumentRangeInspection

export type MarkdownDocumentService = Disposable & {
	bindSocket(options: {
		readonly actor: string
		readonly session: string
		readonly socket: Socket
	}): Promise<() => Promise<void>>
	command(identity: {
		readonly actor: string
		readonly command: MarkdownCommand
		readonly session: string
	}): Promise<MosaicAcceptedDomainBatchEnvelope>
	readonly domain: MarkdownDocumentDomain
	history(identity: {
		readonly actor: string
		readonly session: string
	}): MosaicDomainHistoryConnection
	readonly instrumentation: MarkdownDocumentInstrumentation
	readonly indexSummary: MosaicTextIndexSummary | null
	inspectRange(
		range: MosaicTextIndexRange,
	): Promise<MarkdownDocumentRangeInspection>
	readonly length: number
	materialize(): string
	positionAtOffset(offset: number): Promise<MosaicTextIndexLookup>
	resolvePosition(position: MosaicTextRelativePosition): Promise<number>
	readonly revision: number
	sourceSnapshot(): MosaicTextSnapshot
}

export async function createMarkdownDocumentService(
	options: {
		readonly authorizeImport?: (identity: {
			readonly actor: string
			readonly session: string
		}) => boolean | Promise<boolean>
		readonly initialText?: string
		readonly presenceTtlMs?: number
		readonly silo?: Silo
		readonly storage?: MosaicDomainCheckpointStorageAdapter
	} = {},
): Promise<MarkdownDocumentService> {
	let bootstrapText = options.initialText ?? INITIAL_MARKDOWN
	const silo =
		options.silo ??
		new Silo({
			isProduction: process.env.NODE_ENV === `production`,
			lifespan: `ephemeral`,
			name: `markdown-document-server`,
		})
	const domain = await activateMarkdownDocumentDomain({ silo })
	const storage = options.storage ?? new InMemoryMosaicDomainCheckpointStorage()
	const batches = createMosaicDomainBatchServer({
		domain,
		limits: {
			maxBytes: 192 * 1024 * 1024,
			maxMembers: 65_536,
			maxOperations: 65_536,
		},
		storage,
	})
	const source = (): InstanceType<typeof MarkdownText> =>
		silo.getState(markdownSourceAtom) as InstanceType<typeof MarkdownText>
	const document = await createMosaicTextDocumentCoordinator({
		authorizeImport:
			options.authorizeImport ??
			(({ actor, session }) => actor === `ada` || session === `bootstrap`),
		batches,
		domain,
		index: {
			memberAddress: (id) => domain.address(`indexMembers`, id),
			memberModel: markdownIndexMemberModel,
			options: MARKDOWN_INDEX_OPTIONS,
			rootAddress: domain.address(`indexRoot`),
			rootModel: markdownIndexRootModel,
		},
		serviceIdentity: { actor: `markdown-service`, session: `markdown-service` },
		source: {
			address: domain.address(`source`),
			model: markdownSourceModel,
			read: source,
		},
	})
	const history = createMosaicDomainHistoryCoordinator({
		batches,
		completeCompensation: document.completeCompensation,
		domain,
		limits: { undoStepsPerActor: 100 },
		storage,
	})
	const residency = createMosaicDomainResidencyServer({
		batches,
		domain,
		maxResidentMembers: 128,
		range: {
			resolve: ({ limit, member, range }) =>
				member === `indexMembers`
					? document.resolveRange(range, limit)
					: Promise.resolve([]),
			schema: z
				.object({
					end: z.number().int().nonnegative(),
					kind: z.literal(`utf16-range`),
					start: z.number().int().nonnegative(),
				})
				.strict()
				.refine(({ end, start }) => end >= start),
		},
	})
	const presence = createMosaicDomainPresenceServer({
		domain,
		ttlMs: options.presenceTtlMs,
	})
	const command = ({
		actor,
		command,
		session,
	}: {
		readonly actor: string
		readonly command: MarkdownCommand
		readonly session: string
	}): Promise<MosaicAcceptedDomainBatchEnvelope> =>
		document.submit({
			actor,
			command:
				command.type === `import`
					? command
					: {
							gestureId: command.gestureId,
							selection: { anchor: command.anchor, head: command.head },
							sequence: command.sequence,
							text: command.text,
							type: `replace`,
						},
			session,
		})

	if (bootstrapText.length > 0) {
		await command({
			actor: `system`,
			command: {
				gestureId: `bootstrap`,
				sequence: 1,
				text: bootstrapText,
				type: `import`,
			},
			session: `bootstrap`,
		})
		await history.flush()
	}
	bootstrapText = ``

	let disposed = false
	const cleanups = new Set<() => Promise<void>>()
	const acknowledge = <Value>(
		work: Promise<Value>,
		respond: (acknowledgement: MarkdownAcknowledgement<Value>) => void,
	): void => {
		void work.then(
			(value) => respond({ ok: true, value }),
			(error: unknown) =>
				respond({
					ok: false,
					reason: error instanceof Error ? error.message : String(error),
				}),
		)
	}

	return {
		bindSocket({ actor, session, socket }) {
			const unbindResidency = bindMosaicDomainResidencyServerSocket(
				residency.connect({ actor, session }),
				socket,
			)
			const unbindHistory = bindMosaicDomainHistoryServerSocket(
				history.connect({ actor, session }),
				socket,
				{ session },
			)
			const unbindPresence = bindMosaicDomainPresenceServerSocket(
				presence.connect({ actor, session }),
				socket,
			)
			const onCommand = (input: MarkdownCommand, respond: any): void =>
				acknowledge(command({ actor, command: input, session }), respond)
			const onMaterialize = (respond: any): void =>
				acknowledge(Promise.resolve(document.materialize()), respond)
			const onPosition = (offset: number, respond: any): void =>
				acknowledge(document.positionAtOffset(offset), respond)
			const onResolve = (
				position: MosaicTextRelativePosition,
				respond: any,
			): void =>
				acknowledge(Promise.resolve(document.resolvePosition(position)), respond)
			socket.on(MARKDOWN_EVENTS.command, onCommand)
			socket.on(MARKDOWN_EVENTS.materialize, onMaterialize)
			socket.on(MARKDOWN_EVENTS.positionAtOffset, onPosition)
			socket.on(MARKDOWN_EVENTS.resolvePosition, onResolve)
			let cleaned = false
			const cleanup = async (): Promise<void> => {
				if (cleaned) return
				cleaned = true
				socket.off(MARKDOWN_EVENTS.command, onCommand)
				socket.off(MARKDOWN_EVENTS.materialize, onMaterialize)
				socket.off(MARKDOWN_EVENTS.positionAtOffset, onPosition)
				socket.off(MARKDOWN_EVENTS.resolvePosition, onResolve)
				unbindResidency()
				unbindHistory()
				await unbindPresence()
				cleanups.delete(cleanup)
			}
			cleanups.add(cleanup)
			return Promise.resolve(cleanup)
		},
		command,
		domain,
		history: (identity) => history.connect(identity),
		get instrumentation() {
			return {
				...document.instrumentation,
				activeFullDocumentModels: 1 as const,
				maximumFullDocumentModels: 1 as const,
			}
		},
		get indexSummary() {
			return document.indexSummary
		},
		inspectRange: document.inspectRange,
		get length() {
			return document.length
		},
		materialize: document.materialize,
		positionAtOffset: document.positionAtOffset,
		resolvePosition: (position) =>
			Promise.resolve(document.resolvePosition(position)),
		get revision() {
			return batches.revision
		},
		sourceSnapshot: () => source().toJSON(),
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			for (const cleanup of cleanups) void cleanup().catch(() => undefined)
			presence[Symbol.dispose]()
			residency[Symbol.dispose]()
			history[Symbol.dispose]()
			document[Symbol.dispose]()
			batches.dispose()
			domain[Symbol.dispose]()
		},
	}
}
