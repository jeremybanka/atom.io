import { Silo } from "atom.io"
import {
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
	createMosaicTextIndex,
	createMosaicTextIndexReader,
	maintainMosaicTextIndex,
	mosaicDomainMemberModelIdentity,
	mosaicTextIndexSource,
	type MosaicAcceptedDomainBatchEnvelope,
	type MosaicDomainBatchMemberOperation,
	type MosaicDomainBatchProposal,
	type MosaicTextIndexBundle,
	type MosaicTextIndexReader,
	type MosaicTextIndexReadCounters,
	type MosaicTextIndexLookup,
	type MosaicTextIndexRange,
	type MosaicTextIndexSummary,
	type MosaicTextInsertedRun,
	type MosaicTextOperation,
	type MosaicTextRelativePosition,
	type MosaicTextSnapshot,
} from "atom.io/realtime"
import {
	bindMosaicDomainHistoryServerSocket,
	bindMosaicDomainPresenceServerSocket,
	createMosaicDomainBatchServer,
	createMosaicDomainHistoryCoordinator,
	createMosaicDomainPresenceServer,
	createMosaicDomainResidencyServer,
	InMemoryMosaicDomainCheckpointStorage,
	type MosaicDomainHistoryConnection,
	type MosaicDomainCheckpointStorageAdapter,
	type MosaicDomainResidencyServer,
} from "atom.io/realtime-server"
import type { Socket } from "socket.io"
import { z } from "zod"

import {
	activateMarkdownDocumentDomain,
	markdownIndexMemberModel,
	markdownIndexRootModel,
	markdownSourceModel,
	markdownSourceAtom,
	type MarkdownText,
	type MarkdownDocumentDomain,
} from "../src/document-domain.ts"
import { INITIAL_MARKDOWN } from "../src/initial-markdown.ts"
import {
	MARKDOWN_EVENTS,
	type MarkdownAcknowledgement,
	type MarkdownCommand,
} from "../src/protocol.ts"

const INDEX_OPTIONS = {
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

type StagedDocument = {
	readonly index: MosaicTextIndexBundle
}

export type MarkdownDocumentInstrumentation = {
	readonly activeFullDocumentModels: number
	readonly batches: number
	readonly deliveredPayloadBytes: number
	readonly indexLeavesWritten: number
	readonly indexNodesWritten: number
	readonly lastIndexAliasesWritten: number
	readonly lastIndexLeavesWritten: number
	readonly lastIndexMembersRemoved: number
	readonly lastIndexNodesWritten: number
	readonly lastBatchOperations: number
	readonly memberLoads: number
	readonly materializations: number
	readonly maximumBatchOperations: number
	readonly maximumDeliveredPayloadBytes: number
	readonly maximumFullDocumentModels: number
}

export type MarkdownDocumentRangeInspection = {
	readonly counters: MosaicTextIndexReadCounters
	readonly leafIds: readonly string[]
	readonly projectionText: string
	readonly residentBytes: number
	readonly residentMemberCount: number
}

export type MarkdownDocumentSnapshot = {
	readonly index: MosaicTextIndexBundle
	readonly revision: number
	readonly source: MosaicTextSnapshot
}

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
	resolveIndexAlias(
		id: string,
		range: MosaicTextIndexRange,
	): ReturnType<MosaicTextIndexReader[`resolveAlias`]>
	resolvePosition(position: MosaicTextRelativePosition): Promise<number>
	readonly revision: number
	snapshot(): MarkdownDocumentSnapshot
	sourceSnapshot(): MosaicTextSnapshot
}

const uniqueAddresses = (
	operations: readonly MosaicDomainBatchMemberOperation<
		MarkdownDocumentDomain[`identity`]
	>[],
) => {
	const seen = new Set<string>()
	return operations
		.map(({ address }) => address)
		.filter((address) => {
			const key = JSON.stringify(address)
			if (seen.has(key)) return false
			seen.add(key)
			return true
		})
}

const markdownSegmenter = new Intl.Segmenter(undefined, {
	granularity: `grapheme`,
})

/**
 * Visit graphemes without allocating a document-sized array. The ASCII fast
 * path is important for corpus imports; Intl.Segmenter owns every complex
 * boundary, including CRLF, combining marks, and emoji ZWJ sequences.
 */
const visitMarkdownGraphemes = (
	text: string,
	visit: (start: number, end: number) => void,
): void => {
	let cursor = 0
	while (cursor < text.length) {
		if (text.charCodeAt(cursor) <= 0x7f) {
			let end = cursor + 1
			while (end < text.length && text.charCodeAt(end) <= 0x7f) end++
			const retained =
				end < text.length &&
				end - cursor >= 2 &&
				text.charCodeAt(end - 2) === 0x0d &&
				text.charCodeAt(end - 1) === 0x0a
					? 2
					: 1
			const fastEnd =
				end === text.length ? end : Math.max(cursor, end - retained)
			while (cursor < fastEnd) {
				const next =
					text.charCodeAt(cursor) === 0x0d &&
					cursor + 1 < fastEnd &&
					text.charCodeAt(cursor + 1) === 0x0a
						? cursor + 2
						: cursor + 1
				visit(cursor, next)
				cursor = next
			}
			if (cursor === text.length) break
		}

		const complexStart = cursor
		let complexEnd = text.length
		for (let index = cursor + 1; index < text.length; index++) {
			const previous = text.charCodeAt(index - 1)
			const current = text.charCodeAt(index)
			if (
				previous <= 0x7f &&
				current <= 0x7f &&
				!(previous === 0x0d && current === 0x0a)
			) {
				complexEnd = index
				break
			}
		}
		const complex = text.slice(complexStart, complexEnd)
		for (const { index, segment } of markdownSegmenter.segment(complex)) {
			visit(complexStart + index, complexStart + index + segment.length)
		}
		cursor = complexEnd
	}
}

const prepareMarkdownImportOperation = (
	source: InstanceType<typeof MarkdownText>,
	text: string,
	operationId: string,
): MosaicTextOperation => {
	const inserted: MosaicTextInsertedRun[] = []
	let chunkStart = 0
	let chunkEnd = 0
	let chunkGraphemes = 0
	let previousRun: { readonly graphemes: number; readonly id: string } | null =
		null
	const flush = (): void => {
		if (chunkGraphemes === 0) return
		const id = `${operationId}:run:${inserted.length.toString().padStart(6, `0`)}`
		inserted.push({
			after:
				previousRun === null
					? null
					: {
							offset: previousRun.graphemes,
							runId: previousRun.id,
						},
			before: null,
			id,
			text: text.slice(chunkStart, chunkEnd),
		})
		previousRun = { graphemes: chunkGraphemes, id }
		chunkStart = chunkEnd
		chunkGraphemes = 0
	}
	visitMarkdownGraphemes(text, (start, end) => {
		if (
			chunkGraphemes > 0 &&
			(chunkGraphemes === 32_768 || end - chunkStart > 65_536)
		) {
			chunkEnd = start
			flush()
		}
		chunkEnd = end
		chunkGraphemes++
	})
	flush()
	return {
		deleted: source.runs.map(({ end, id, start }) => ({
			end,
			runId: id,
			start,
		})),
		inserted,
		type: `edit`,
	}
}

export async function createMarkdownDocumentService(
	options: {
		readonly authorizeImport?: (identity: {
			readonly actor: string
			readonly session: string
		}) => boolean | Promise<boolean>
		readonly initialText?: string
		readonly silo?: Silo
		readonly storage?: MosaicDomainCheckpointStorageAdapter
	} = {},
): Promise<MarkdownDocumentService> {
	const authorizeImport = options.authorizeImport
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
	const recovery = await batches
		.connect({ actor: `markdown-recovery`, session: `markdown-recovery` })
		.recover()
	// The activated Domain already owns and recovers the authoritative text
	// transceiver. A second service-side shadow would double every large source
	// and make process restart needlessly replay it twice.
	const source = (): InstanceType<typeof MarkdownText> =>
		// getState deliberately exposes the read-only view. The Domain owns the
		// same transceiver instance; this server uses only its pure prepare,
		// preview, and serialization methods.
		silo.getState(markdownSourceAtom) as InstanceType<typeof MarkdownText>
	let current: StagedDocument = {
		index: createMosaicTextIndex(
			source().runs.map(({ id, start, text }) => ({ runId: id, start, text })),
			INDEX_OPTIONS,
		),
	}
	let headBatchId: string | null = recovery.tail.at(-1)?.batch.id ?? null
	let disposed = false
	let commandTail = Promise.resolve()
	const staged = new Map<string, StagedDocument>()
	const counters = {
		activeFullDocumentModels: 1,
		batches: 0,
		deliveredPayloadBytes: 0,
		indexLeavesWritten: 0,
		indexNodesWritten: 0,
		lastIndexAliasesWritten: 0,
		lastIndexLeavesWritten: 0,
		lastIndexMembersRemoved: 0,
		lastIndexNodesWritten: 0,
		lastBatchOperations: 0,
		memberLoads: 0,
		materializations: 0,
		maximumBatchOperations: 0,
		maximumDeliveredPayloadBytes: 0,
		maximumFullDocumentModels: 1,
	}

	const stageRuns = (
		runs: readonly {
			readonly id: string
			readonly start: number
			readonly text: string
		}[],
		batchId: string,
	): {
		readonly document: StagedDocument
		readonly operations: readonly MosaicDomainBatchMemberOperation<
			typeof domain.identity
		>[]
	} => {
		const maintenance = maintainMosaicTextIndex(
			current.index,
			runs.map(({ id, start, text }) => ({ runId: id, start, text })),
			INDEX_OPTIONS,
		)
		counters.indexLeavesWritten += maintenance.counters.leavesWritten
		counters.indexNodesWritten += maintenance.counters.nodesWritten
		counters.lastIndexAliasesWritten = maintenance.counters.aliasesWritten
		counters.lastIndexLeavesWritten = maintenance.counters.leavesWritten
		counters.lastIndexMembersRemoved = maintenance.counters.membersRemoved
		counters.lastIndexNodesWritten = maintenance.counters.nodesWritten
		const document = { index: maintenance.index }
		const operations: MosaicDomainBatchMemberOperation<
			typeof domain.identity
		>[] = []
		if (maintenance.maintenance.root !== null) {
			operations.push({
				address: domain.address(`indexRoot`),
				id: `${batchId}:index-root`,
				model: mosaicDomainMemberModelIdentity(markdownIndexRootModel),
				operation: { type: `set`, value: maintenance.maintenance.root },
			})
		}
		for (const [ordinal, member] of maintenance.maintenance.upsert.entries()) {
			operations.push({
				address: domain.address(`indexMembers`, member.id),
				id: `${batchId}:index:${ordinal}`,
				model: mosaicDomainMemberModelIdentity(markdownIndexMemberModel),
				operation: { type: `set`, value: member },
			})
		}
		staged.set(batchId, document)
		return { document, operations }
	}

	const history = createMosaicDomainHistoryCoordinator({
		batches,
		completeCompensation({ actor, batchId, operations, session }) {
			const currentSource = source()
			let preview = currentSource.runs
			for (const operation of operations) {
				if (operation.address.member !== `source`) continue
				preview = currentSource.preview({
					actor,
					dependencies: headBatchId === null ? [] : [headBatchId],
					group: batchId,
					id: operation.id,
					operation: operation.operation as MosaicTextOperation,
					revision: null,
					session,
				})
			}
			return stageRuns(preview, batchId).operations.map(
				({ address, operation }) => ({ address, operation }),
			)
		},
		domain,
		limits: { undoStepsPerActor: 100 },
		storage,
	})
	const inspectRange = async (
		range: MosaicTextIndexRange,
	): Promise<MarkdownDocumentRangeInspection> => {
		const members = new Map(
			current.index.members.map((member) => [member.id, member]),
		)
		const resident = new Map<string, unknown>()
		const reader = createMosaicTextIndexReader({
			read(id) {
				const member = members.get(id)
				if (member !== undefined) resident.set(id, member)
				return Promise.resolve(member)
			},
			root() {
				resident.set(`root`, current.index.root)
				return Promise.resolve(current.index.root)
			},
		})
		const result = await reader.resolveRange(range, 128)
		if (result.status === `resnapshot`) {
			throw new Error(`Range resnapshot required: ${result.recovery.reason}.`)
		}
		for (const leafId of result.leafIds) {
			const leaf = members.get(leafId)
			if (leaf !== undefined) resident.set(leafId, leaf)
		}
		const memberLoads = Object.values(reader.counters).reduce(
			(total, value) => total + value,
			0,
		)
		counters.memberLoads += memberLoads
		const projectionText = result.leafIds
			.flatMap((leafId) => {
				const member = members.get(leafId)
				return member?.kind === `leaf`
					? member.fragments.map(({ text }) => text)
					: []
			})
			.join(``)
		return {
			counters: { ...reader.counters },
			leafIds: [...result.leafIds],
			projectionText,
			residentBytes: Buffer.byteLength(JSON.stringify([...resident.values()])),
			residentMemberCount: resident.size,
		}
	}
	const positionAtOffset = async (
		offset: number,
	): Promise<MosaicTextIndexLookup> => {
		const reader = createMosaicTextIndexReader(
			mosaicTextIndexSource(current.index),
		)
		const lookup = await reader.positionAtOffset(offset)
		counters.memberLoads += Object.values(reader.counters).reduce(
			(total, value) => total + value,
			0,
		)
		return lookup
	}
	const resolveIndexAlias = (
		id: string,
		range: MosaicTextIndexRange,
	): ReturnType<MosaicTextIndexReader[`resolveAlias`]> => {
		const reader = createMosaicTextIndexReader(
			mosaicTextIndexSource(current.index),
		)
		return reader.resolveAlias(id, range)
	}

	const acceptedConnection = batches.connect({
		actor: `markdown-service`,
		session: `markdown-service`,
	})
	const stopAccepted = acceptedConnection.subscribe((accepted) => {
		headBatchId = accepted.batch.id
		const next = staged.get(accepted.batch.id)
		if (next !== undefined) {
			current = next
			staged.delete(accepted.batch.id)
		}
		counters.batches++
		const deliveredPayloadBytes = Buffer.byteLength(JSON.stringify(accepted))
		counters.deliveredPayloadBytes += deliveredPayloadBytes
		counters.lastBatchOperations = accepted.batch.operations.length
		counters.maximumBatchOperations = Math.max(
			counters.maximumBatchOperations,
			accepted.batch.operations.length,
		)
		counters.maximumDeliveredPayloadBytes = Math.max(
			counters.maximumDeliveredPayloadBytes,
			deliveredPayloadBytes,
		)
	})

	const residency: MosaicDomainResidencyServer<
		typeof domain.identity,
		{ end: number; kind: `utf16-range`; start: number }
	> = createMosaicDomainResidencyServer({
		batches,
		domain,
		maxResidentMembers: 128,
		range: {
			async resolve({ domain: active, limit, member, range }) {
				if (member !== `indexMembers`) return []
				const inspection = await inspectRange(range)
				if (inspection.leafIds.length > limit) {
					throw new Error(`Range resnapshot required: range-member-limit.`)
				}
				return inspection.leafIds.map((leafId) =>
					active.address(`indexMembers`, leafId),
				)
			},
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
	const presence = createMosaicDomainPresenceServer({ domain })

	const submitCommand = async ({
		actor,
		command,
		session,
	}: {
		readonly actor: string
		readonly command: MarkdownCommand
		readonly session: string
	}): Promise<MosaicAcceptedDomainBatchEnvelope> => {
		if (disposed) throw new Error(`The Markdown document service is disposed.`)
		if (command.type === `import`) {
			const authorized =
				authorizeImport === undefined
					? actor === `ada` || session === `bootstrap`
					: await authorizeImport({ actor, session })
			if (!authorized) throw new Error(`Only an authorized actor may import.`)
		}
		const sourceOperationId = `${command.gestureId}:source`
		const context = {
			actor,
			dependencies: headBatchId === null ? [] : [headBatchId],
			group: command.gestureId,
			id: sourceOperationId,
			now: 0,
			revision: null,
			session,
		}
		const currentSource = source()
		const signal =
			command.type === `import`
				? {
						...context,
						operation: prepareMarkdownImportOperation(
							currentSource,
							command.text,
							sourceOperationId,
						),
					}
				: currentSource.prepare(
						{
							selection: { anchor: command.anchor, head: command.head },
							text: command.text,
							type: `replace-selection`,
						},
						context,
					)
		if (signal === null) throw new Error(`The Markdown command made no change.`)
		const sourceOperation: MosaicDomainBatchMemberOperation<
			typeof domain.identity
		> = {
			address: domain.address(`source`),
			id: sourceOperationId,
			model: mosaicDomainMemberModelIdentity(markdownSourceModel),
			operation: signal.operation,
		}
		const index = stageRuns(currentSource.preview(signal), command.gestureId)
		const operations = [sourceOperation, ...index.operations]
		const proposal: MosaicDomainBatchProposal = {
			affectedMembers: uniqueAddresses(operations),
			dependencies: headBatchId === null ? [] : [headBatchId],
			domain: domain.identity,
			group: command.gestureId,
			id: command.gestureId,
			operations,
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: command.sequence,
			session,
		}
		const result = await batches.connect({ actor, session }).propose(proposal)
		if (result.status === `rejected`) {
			staged.delete(command.gestureId)
			throw new Error(result.rejection.reason)
		}
		return result.accepted
	}

	const enqueueCommand = (identity: {
		readonly actor: string
		readonly command: MarkdownCommand
		readonly session: string
	}): Promise<MosaicAcceptedDomainBatchEnvelope> => {
		const result = commandTail.then(() => submitCommand(identity))
		commandTail = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}

	if (bootstrapText.length > 0) {
		await enqueueCommand({
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
	// Do not retain the caller's original whole-document string in the service
	// closure after the Domain has accepted it.
	bootstrapText = ``

	const cleanups = new Set<() => Promise<void>>()
	const materializeDocument = (): string => {
		counters.materializations++
		return source().text
	}
	const resolvePosition = (
		position: MosaicTextRelativePosition,
	): Promise<number> => Promise.resolve(source().resolvePosition(position))
	const acknowledge = <Value>(
		work: Promise<Value>,
		respond: (acknowledgement: MarkdownAcknowledgement<Value>) => void,
	): void => {
		void work.then(
			(value) => {
				respond({ ok: true, value })
			},
			(error: unknown) => {
				respond({
					ok: false,
					reason: error instanceof Error ? error.message : String(error),
				})
			},
		)
	}

	return {
		bindSocket({ actor, session, socket }) {
			const range = residency.connect({ actor, session })
			const historyConnection = history.connect({ actor, session })
			const unbindHistory = bindMosaicDomainHistoryServerSocket(
				historyConnection,
				socket,
				{ session },
			)
			const presenceConnection = presence.connect({ actor, session })
			const unbindPresence = bindMosaicDomainPresenceServerSocket(
				presenceConnection,
				socket,
			)
			const subscriptions = new Map<string, () => void>()
			const onHydrate = (requests: any, respond: any): void => {
				acknowledge(range.hydrate(requests), respond)
			}
			const onPropose = (proposal: any, respond: any): void => {
				acknowledge(range.propose(proposal), respond)
			}
			const onSubscribe = (id: string, requests: any, respond: any): void => {
				acknowledge(
					Promise.resolve(
						range.subscribe(requests, (accepted) => {
							socket.emit(MARKDOWN_EVENTS.accepted, id, accepted)
						}),
					).then((stop) => {
						subscriptions.get(id)?.()
						subscriptions.set(id, stop)
					}),
					respond,
				)
			}
			const onUnsubscribe = (id: string): void => {
				subscriptions.get(id)?.()
				subscriptions.delete(id)
			}
			const onCommand = (command: MarkdownCommand, respond: any): void => {
				acknowledge(enqueueCommand({ actor, command, session }), respond)
			}
			const onMaterialize = (respond: any): void => {
				acknowledge(Promise.resolve(materializeDocument()), respond)
			}
			const onPosition = (offset: number, respond: any): void => {
				acknowledge(positionAtOffset(offset), respond)
			}
			const onResolve = (
				position: MosaicTextRelativePosition,
				respond: any,
			): void => {
				acknowledge(resolvePosition(position), respond)
			}
			socket.on(MARKDOWN_EVENTS.hydrate, onHydrate)
			socket.on(MARKDOWN_EVENTS.recover, onPropose)
			socket.on(MARKDOWN_EVENTS.subscribe, onSubscribe)
			socket.on(MARKDOWN_EVENTS.unsubscribe, onUnsubscribe)
			socket.on(MARKDOWN_EVENTS.command, onCommand)
			socket.on(MARKDOWN_EVENTS.materialize, onMaterialize)
			socket.on(MARKDOWN_EVENTS.positionAtOffset, onPosition)
			socket.on(MARKDOWN_EVENTS.resolvePosition, onResolve)
			let cleaned = false
			const cleanup = async (): Promise<void> => {
				if (cleaned) return
				cleaned = true
				for (const stop of subscriptions.values()) stop()
				subscriptions.clear()
				socket.off(MARKDOWN_EVENTS.hydrate, onHydrate)
				socket.off(MARKDOWN_EVENTS.recover, onPropose)
				socket.off(MARKDOWN_EVENTS.subscribe, onSubscribe)
				socket.off(MARKDOWN_EVENTS.unsubscribe, onUnsubscribe)
				socket.off(MARKDOWN_EVENTS.command, onCommand)
				socket.off(MARKDOWN_EVENTS.materialize, onMaterialize)
				socket.off(MARKDOWN_EVENTS.positionAtOffset, onPosition)
				socket.off(MARKDOWN_EVENTS.resolvePosition, onResolve)
				range.dispose?.()
				unbindHistory()
				// The socket binding owns the presence connection and disconnects it.
				await unbindPresence()
				cleanups.delete(cleanup)
			}
			cleanups.add(cleanup)
			return Promise.resolve(cleanup)
		},
		command: enqueueCommand,
		domain,
		history: (identity) => history.connect(identity),
		get instrumentation() {
			return { ...counters }
		},
		get indexSummary() {
			return structuredClone(current.index.root.reference?.summary ?? null)
		},
		inspectRange,
		get length() {
			return current.index.root.reference?.summary.utf16Units ?? 0
		},
		materialize: materializeDocument,
		positionAtOffset,
		resolveIndexAlias,
		resolvePosition,
		get revision() {
			return batches.revision
		},
		snapshot() {
			return {
				index: structuredClone(current.index),
				revision: batches.revision,
				source: source().toJSON(),
			}
		},
		sourceSnapshot() {
			return source().toJSON()
		},
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			for (const cleanup of cleanups) void cleanup().catch(() => undefined)
			stopAccepted()
			presence[Symbol.dispose]()
			residency[Symbol.dispose]()
			history[Symbol.dispose]()
			batches.dispose()
			domain[Symbol.dispose]()
		},
	}
}
