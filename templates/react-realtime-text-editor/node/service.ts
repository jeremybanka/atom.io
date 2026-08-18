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
	type MosaicTextIndexLookup,
	type MosaicTextOperation,
	type MosaicTextRelativePosition,
} from "atom.io/realtime"
import {
	bindMosaicDomainPresenceServerSocket,
	createMosaicDomainBatchServer,
	createMosaicDomainHistoryCoordinator,
	createMosaicDomainPresenceServer,
	createMosaicDomainResidencyServer,
	InMemoryMosaicDomainCheckpointStorage,
	type MosaicDomainHistoryConnection,
	type MosaicDomainResidencyServer,
} from "atom.io/realtime-server"
import type { Socket } from "socket.io"
import { z } from "zod"

import {
	activateMarkdownDocumentDomain,
	emptyMarkdownTextSnapshot,
	markdownIndexMemberModel,
	markdownIndexRootModel,
	markdownSourceModel,
	MarkdownText,
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
	readonly batches: number
	readonly indexLeavesWritten: number
	readonly indexNodesWritten: number
	readonly lastBatchOperations: number
	readonly materializations: number
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
	materialize(): string
	positionAtOffset(offset: number): Promise<MosaicTextIndexLookup>
	resolvePosition(position: MosaicTextRelativePosition): Promise<number>
	readonly revision: number
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

export async function createMarkdownDocumentService(
	options: {
		readonly authorizeImport?: (identity: {
			readonly actor: string
			readonly session: string
		}) => boolean | Promise<boolean>
		readonly initialText?: string
		readonly silo?: Silo
	} = {},
): Promise<MarkdownDocumentService> {
	const silo =
		options.silo ??
		new Silo({
			isProduction: process.env.NODE_ENV === `production`,
			lifespan: `ephemeral`,
			name: `markdown-document-server`,
		})
	const domain = await activateMarkdownDocumentDomain({ silo })
	const storage = new InMemoryMosaicDomainCheckpointStorage()
	const batches = createMosaicDomainBatchServer({
		domain,
		limits: {
			maxBytes: 192 * 1024 * 1024,
			maxMembers: 65_536,
			maxOperations: 65_536,
		},
		storage,
	})
	let current: StagedDocument = {
		index: createMosaicTextIndex([], INDEX_OPTIONS),
	}
	const source = MarkdownText.fromJSON(emptyMarkdownTextSnapshot())
	let headBatchId: string | null = null
	let disposed = false
	let commandTail = Promise.resolve()
	const staged = new Map<string, StagedDocument>()
	const counters = {
		batches: 0,
		indexLeavesWritten: 0,
		indexNodesWritten: 0,
		lastBatchOperations: 0,
		materializations: 0,
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
			let preview = source.runs
			for (const operation of operations) {
				if (operation.address.member !== `source`) continue
				preview = source.preview({
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

	const acceptedConnection = batches.connect({
		actor: `markdown-service`,
		session: `markdown-service`,
	})
	const stopAccepted = acceptedConnection.subscribe((accepted) => {
		for (const operation of accepted.batch.operations) {
			if (operation.address.member !== `source`) continue
			source.do({
				actor: accepted.batch.actor,
				dependencies: accepted.batch.dependencies,
				group: accepted.batch.group,
				id: operation.id,
				operation: operation.operation as MosaicTextOperation,
				revision: accepted.revision,
				session: accepted.batch.session,
			})
		}
		headBatchId = accepted.batch.id
		const next = staged.get(accepted.batch.id)
		if (next !== undefined) {
			current = next
			staged.delete(accepted.batch.id)
		}
		counters.batches++
		counters.lastBatchOperations = accepted.batch.operations.length
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
				const result = await createMosaicTextIndexReader(
					mosaicTextIndexSource(current.index),
				).resolveRange(range, limit)
				if (result.status === `resnapshot`) {
					throw new Error(
						`Range resnapshot required: ${result.recovery.reason}.`,
					)
				}
				return result.leafIds.map((leafId) =>
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
				options.authorizeImport === undefined
					? actor === `ada` || session === `bootstrap`
					: await options.authorizeImport({ actor, session })
			if (!authorized) throw new Error(`Only an authorized actor may import.`)
		}
		const sourceOperationId = `${command.gestureId}:source`
		const signal = source.prepare(
			{
				selection:
					command.type === `import`
						? {
								anchor: { affinity: `right`, offset: 0, runId: null },
								head: { affinity: `left`, offset: 0, runId: null },
							}
						: { anchor: command.anchor, head: command.head },
				text: command.text,
				type: `replace-selection`,
			},
			{
				actor,
				dependencies: headBatchId === null ? [] : [headBatchId],
				group: command.gestureId,
				id: sourceOperationId,
				now: 0,
				revision: null,
				session,
			},
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
		const index = stageRuns(source.preview(signal), command.gestureId)
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

	if ((options.initialText ?? INITIAL_MARKDOWN).length > 0) {
		await enqueueCommand({
			actor: `system`,
			command: {
				gestureId: `bootstrap`,
				sequence: 1,
				text: options.initialText ?? INITIAL_MARKDOWN,
				type: `import`,
			},
			session: `bootstrap`,
		})
		await history.flush()
	}

	const cleanups = new Set<() => Promise<void>>()
	const materializeDocument = (): string => {
		counters.materializations++
		return source.text
	}
	const positionAtOffset = (offset: number): Promise<MosaicTextIndexLookup> =>
		createMosaicTextIndexReader(
			mosaicTextIndexSource(current.index),
		).positionAtOffset(offset)
	const resolvePosition = (
		position: MosaicTextRelativePosition,
	): Promise<number> => Promise.resolve(source.resolvePosition(position))
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
		async bindSocket({ actor, session, socket }) {
			const range = residency.connect({ actor, session })
			const historyConnection = history.connect({ actor, session })
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
			const onHistorySnapshot = (respond: any): void => {
				acknowledge(historyConnection.snapshot(), respond)
			}
			const onHistory = (request: any, respond: any): void => {
				acknowledge(historyConnection.request(request), respond)
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
			socket.on(MARKDOWN_EVENTS.historySnapshot, onHistorySnapshot)
			socket.on(MARKDOWN_EVENTS.history, onHistory)
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
				socket.off(MARKDOWN_EVENTS.historySnapshot, onHistorySnapshot)
				socket.off(MARKDOWN_EVENTS.history, onHistory)
				socket.off(MARKDOWN_EVENTS.materialize, onMaterialize)
				socket.off(MARKDOWN_EVENTS.positionAtOffset, onPosition)
				socket.off(MARKDOWN_EVENTS.resolvePosition, onResolve)
				range.dispose?.()
				historyConnection[Symbol.dispose]()
				// The socket binding owns the presence connection and disconnects it.
				await unbindPresence()
				cleanups.delete(cleanup)
			}
			cleanups.add(cleanup)
			return cleanup
		},
		command: enqueueCommand,
		domain,
		history: (identity) => history.connect(identity),
		get instrumentation() {
			return { ...counters }
		},
		materialize: materializeDocument,
		positionAtOffset,
		resolvePosition,
		get revision() {
			return batches.revision
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
