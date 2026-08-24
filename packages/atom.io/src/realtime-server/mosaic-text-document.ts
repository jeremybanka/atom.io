import type { Json } from "atom.io/foundations/json"
import {
	createMosaicTextIndex,
	createMosaicTextIndexReader,
	maintainMosaicTextIndex,
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
	type MosaicAcceptedDomainBatchEnvelope,
	type MosaicDomainBatchMemberOperation,
	type MosaicDomainBatchProposal,
	type MosaicDomainIdentity,
	type MosaicDomainInstance,
	type MosaicDomainMemberAddress,
	mosaicDomainMemberAddressKey,
	type MosaicDomainMemberModel,
	mosaicDomainMemberModelIdentity,
	type MosaicTextIndexBundle,
	type MosaicTextIndexLookup,
	type MosaicTextIndexOptions,
	type MosaicTextIndexRange,
	type MosaicTextIndexReadCounters,
	mosaicTextIndexSource,
	type MosaicTextIndexSummary,
	type MosaicTextInsertedRun,
	type MosaicTextOperation,
	type MosaicTextRelativePosition,
	type MosaicTextSelection,
	type MosaicTextTransceiver,
	visitMosaicTextGraphemes,
} from "atom.io/realtime"

import type { MosaicDomainBatchServer } from "./mosaic-domain-batch-server.ts"
import type { MosaicDomainHistoryCoordinatorOptions } from "./mosaic-domain-history.ts"

export type MosaicTextDocumentCommand =
	| {
			readonly gestureId: string
			readonly sequence: number
			readonly text: string
			readonly type: `import`
	  }
	| {
			readonly gestureId: string
			readonly selection: MosaicTextSelection
			readonly sequence: number
			readonly text: string
			readonly type: `replace`
	  }

export type MosaicTextDocumentInstrumentation = {
	readonly batches: number
	readonly deliveredPayloadBytes: number
	readonly indexLeavesWritten: number
	readonly indexNodesWritten: number
	readonly lastBatchOperations: number
	readonly lastIndexAliasesWritten: number
	readonly lastIndexLeavesWritten: number
	readonly lastIndexMembersRemoved: number
	readonly lastIndexNodesWritten: number
	readonly materializations: number
	readonly maximumBatchOperations: number
	readonly maximumDeliveredPayloadBytes: number
	readonly memberLoads: number
}

export type MosaicTextDocumentRangeInspection = {
	readonly counters: MosaicTextIndexReadCounters
	readonly leafIds: readonly string[]
	readonly projectionText: string
	readonly residentBytes: number
	readonly residentMemberCount: number
}

export type MosaicTextDocumentCoordinator<
	Identity extends MosaicDomainIdentity = MosaicDomainIdentity,
> = Disposable & {
	readonly completeCompensation: NonNullable<
		MosaicDomainHistoryCoordinatorOptions<Identity>[`completeCompensation`]
	>
	readonly indexSummary: MosaicTextIndexSummary | null
	readonly instrumentation: MosaicTextDocumentInstrumentation
	inspectRange(
		range: MosaicTextIndexRange,
		limit?: number,
	): Promise<MosaicTextDocumentRangeInspection>
	readonly length: number
	materialize(): string
	positionAtOffset(offset: number): Promise<MosaicTextIndexLookup>
	resolveIndexAlias(
		id: string,
		range: MosaicTextIndexRange,
	): ReturnType<ReturnType<typeof createMosaicTextIndexReader>[`resolveAlias`]>
	resolvePosition(position: MosaicTextRelativePosition): number
	resolveRange(
		range: MosaicTextIndexRange,
		limit: number,
	): Promise<readonly MosaicDomainMemberAddress<Identity>[]>
	submit(identity: {
		readonly actor: string
		readonly command: MosaicTextDocumentCommand
		readonly session: string
	}): Promise<MosaicAcceptedDomainBatchEnvelope<Identity>>
}

const uniqueAddresses = <Identity extends MosaicDomainIdentity>(
	operations: readonly MosaicDomainBatchMemberOperation<Identity>[],
): readonly MosaicDomainMemberAddress<Identity>[] => {
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

/** Build bounded, grapheme-safe inserted runs without a document-sized array. */
export function prepareMosaicTextImportOperation(
	source: Pick<MosaicTextTransceiver, `runs`>,
	text: string,
	operationId: string,
	options: {
		readonly maximumRunGraphemes?: number
		readonly maximumRunUtf16Units?: number
	} = {},
): MosaicTextOperation {
	const maximumRunGraphemes = options.maximumRunGraphemes ?? 32_768
	const maximumRunUtf16Units = options.maximumRunUtf16Units ?? 65_536
	if (
		!Number.isSafeInteger(maximumRunGraphemes) ||
		maximumRunGraphemes < 1 ||
		!Number.isSafeInteger(maximumRunUtf16Units) ||
		maximumRunUtf16Units < 1
	) {
		throw new Error(`Mosaic text import limits must be positive safe integers.`)
	}
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
					: { offset: previousRun.graphemes, runId: previousRun.id },
			before: null,
			id,
			text: text.slice(chunkStart, chunkEnd),
		})
		previousRun = { graphemes: chunkGraphemes, id }
		chunkStart = chunkEnd
		chunkGraphemes = 0
	}
	visitMosaicTextGraphemes(text, (start, end) => {
		if (end - start > maximumRunUtf16Units) {
			throw new Error(`A Mosaic text grapheme exceeds the import run limit.`)
		}
		if (
			chunkGraphemes > 0 &&
			(chunkGraphemes === maximumRunGraphemes ||
				end - chunkStart > maximumRunUtf16Units)
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

/** Coordinate one authoritative v2 Mosaic text model and its range index. */
export async function createMosaicTextDocumentCoordinator<
	Identity extends MosaicDomainIdentity,
>(options: {
	readonly authorizeImport?: (identity: {
		readonly actor: string
		readonly session: string
	}) => boolean | Promise<boolean>
	readonly batches: MosaicDomainBatchServer
	readonly domain: MosaicDomainInstance<Identity, any, any>
	readonly import?: {
		readonly maximumRunGraphemes?: number
		readonly maximumRunUtf16Units?: number
	}
	readonly index: {
		readonly memberAddress: (id: string) => MosaicDomainMemberAddress<Identity>
		readonly memberModel: MosaicDomainMemberModel
		readonly options?: MosaicTextIndexOptions
		readonly rootAddress: MosaicDomainMemberAddress<Identity>
		readonly rootModel: MosaicDomainMemberModel
	}
	readonly serviceIdentity?: { readonly actor: string; readonly session: string }
	readonly source: {
		readonly address: MosaicDomainMemberAddress<Identity>
		readonly model: MosaicDomainMemberModel
		readonly read: () => MosaicTextTransceiver
	}
}): Promise<MosaicTextDocumentCoordinator<Identity>> {
	const serviceIdentity = options.serviceIdentity ?? {
		actor: `mosaic-text-service`,
		session: `mosaic-text-service`,
	}
	const indexOptions = options.index.options ?? {}
	const recovery = await options.batches.connect(serviceIdentity).recover()
	const source = options.source.read
	let current: MosaicTextIndexBundle = createMosaicTextIndex(
		source().runs.map(({ id, start, text }) => ({ runId: id, start, text })),
		indexOptions,
	)
	let headBatchId: string | null = recovery.tail.at(-1)?.batch.id ?? null
	let disposed = false
	let commandTail = Promise.resolve()
	const staged = new Map<string, MosaicTextIndexBundle>()
	const counters = {
		batches: 0,
		deliveredPayloadBytes: 0,
		indexLeavesWritten: 0,
		indexNodesWritten: 0,
		lastBatchOperations: 0,
		lastIndexAliasesWritten: 0,
		lastIndexLeavesWritten: 0,
		lastIndexMembersRemoved: 0,
		lastIndexNodesWritten: 0,
		materializations: 0,
		maximumBatchOperations: 0,
		maximumDeliveredPayloadBytes: 0,
		memberLoads: 0,
	}
	const stageRuns = (
		runs: readonly {
			readonly id: string
			readonly start: number
			readonly text: string
		}[],
		batchId: string,
	): readonly MosaicDomainBatchMemberOperation<Identity>[] => {
		const maintenance = maintainMosaicTextIndex(
			current,
			runs.map(({ id, start, text }) => ({ runId: id, start, text })),
			indexOptions,
		)
		counters.indexLeavesWritten += maintenance.counters.leavesWritten
		counters.indexNodesWritten += maintenance.counters.nodesWritten
		counters.lastIndexAliasesWritten = maintenance.counters.aliasesWritten
		counters.lastIndexLeavesWritten = maintenance.counters.leavesWritten
		counters.lastIndexMembersRemoved = maintenance.counters.membersRemoved
		counters.lastIndexNodesWritten = maintenance.counters.nodesWritten
		const operations: MosaicDomainBatchMemberOperation<Identity>[] = []
		if (maintenance.maintenance.root !== null) {
			operations.push({
				address: options.index.rootAddress,
				id: `${batchId}:index-root`,
				model: mosaicDomainMemberModelIdentity(options.index.rootModel),
				operation: { type: `set`, value: maintenance.maintenance.root },
			})
		}
		for (const [ordinal, member] of maintenance.maintenance.upsert.entries()) {
			operations.push({
				address: options.index.memberAddress(member.id),
				id: `${batchId}:index:${ordinal}`,
				model: mosaicDomainMemberModelIdentity(options.index.memberModel),
				operation: { type: `set`, value: member },
			})
		}
		staged.set(batchId, maintenance.index)
		return operations
	}
	const inspectRange = async (
		range: MosaicTextIndexRange,
		limit = 128,
	): Promise<MosaicTextDocumentRangeInspection> => {
		const length = current.root.reference?.summary.utf16Units ?? 0
		const residentRange = {
			end: Math.min(range.end, length),
			kind: `utf16-range` as const,
			start: Math.min(range.start, length),
		}
		const members = new Map(current.members.map((member) => [member.id, member]))
		const resident = new Map<string, Json.Serializable>()
		const reader = createMosaicTextIndexReader({
			read(id) {
				const member = members.get(id)
				if (member !== undefined) resident.set(id, member)
				return Promise.resolve(member)
			},
			root() {
				resident.set(`root`, current.root)
				return Promise.resolve(current.root)
			},
		})
		const result = await reader.resolveRange(residentRange, limit)
		if (result.status === `resnapshot`) {
			throw new Error(`Range resnapshot required: ${result.recovery.reason}.`)
		}
		for (const leafId of result.leafIds) {
			const leaf = members.get(leafId)
			if (leaf !== undefined) resident.set(leafId, leaf)
		}
		counters.memberLoads += Object.values(reader.counters).reduce(
			(total, value) => total + value,
			0,
		)
		return {
			counters: { ...reader.counters },
			leafIds: [...result.leafIds],
			projectionText: result.leafIds
				.flatMap((leafId) => {
					const member = members.get(leafId)
					return member?.kind === `leaf`
						? member.fragments.map(({ text }) => text)
						: []
				})
				.join(``),
			residentBytes: Buffer.byteLength(JSON.stringify([...resident.values()])),
			residentMemberCount: resident.size,
		}
	}
	const accepted = options.batches.connect(serviceIdentity)
	const stopAccepted = accepted.subscribe((envelope) => {
		headBatchId = envelope.batch.id
		const next = staged.get(envelope.batch.id)
		if (next !== undefined) {
			current = next
			staged.delete(envelope.batch.id)
		}
		counters.batches++
		const bytes = Buffer.byteLength(JSON.stringify(envelope))
		counters.deliveredPayloadBytes += bytes
		counters.lastBatchOperations = envelope.batch.operations.length
		counters.maximumBatchOperations = Math.max(
			counters.maximumBatchOperations,
			envelope.batch.operations.length,
		)
		counters.maximumDeliveredPayloadBytes = Math.max(
			counters.maximumDeliveredPayloadBytes,
			bytes,
		)
	})
	const completeCompensation: NonNullable<
		MosaicDomainHistoryCoordinatorOptions<Identity>[`completeCompensation`]
	> = ({ actor, batchId, operations, session }) => {
		const currentSource = source()
		let preview = currentSource.runs
		for (const operation of operations) {
			if (
				mosaicDomainMemberAddressKey(operation.address) !==
				mosaicDomainMemberAddressKey(options.source.address)
			) {
				continue
			}
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
		return stageRuns(preview, batchId).map(({ address, operation }) => ({
			address,
			operation,
		}))
	}
	const submitOne = async ({
		actor,
		command,
		session,
	}: {
		readonly actor: string
		readonly command: MosaicTextDocumentCommand
		readonly session: string
	}): Promise<MosaicAcceptedDomainBatchEnvelope<Identity>> => {
		if (disposed) throw new Error(`The Mosaic text document is disposed.`)
		if (command.type === `import`) {
			const authorized = await options.authorizeImport?.({ actor, session })
			if (authorized !== true) {
				throw new Error(
					`This actor is not authorized to import the Mosaic text document.`,
				)
			}
		}
		const operationId = `${command.gestureId}:source`
		const context = {
			actor,
			dependencies: headBatchId === null ? [] : [headBatchId],
			group: command.gestureId,
			id: operationId,
			now: 0,
			revision: null,
			session,
		} as const
		const currentSource = source()
		const signal =
			command.type === `import`
				? {
						...context,
						operation: prepareMosaicTextImportOperation(
							currentSource,
							command.text,
							operationId,
							options.import,
						),
					}
				: currentSource.prepare(
						{
							selection: command.selection,
							text: command.text,
							type: `replace-selection`,
						},
						context,
					)
		if (
			signal === null ||
			(signal.operation.type === `edit` &&
				signal.operation.deleted.length === 0 &&
				signal.operation.inserted.length === 0)
		) {
			throw new Error(`The Mosaic text command made no change.`)
		}
		const sourceOperation: MosaicDomainBatchMemberOperation<Identity> = {
			address: options.source.address,
			id: operationId,
			model: mosaicDomainMemberModelIdentity(options.source.model),
			operation: signal.operation,
		}
		const operations = [
			sourceOperation,
			...stageRuns(currentSource.preview(signal), command.gestureId),
		]
		const proposal: MosaicDomainBatchProposal<Identity> = {
			affectedMembers: uniqueAddresses(operations),
			dependencies: headBatchId === null ? [] : [headBatchId],
			domain: options.domain.identity,
			group: command.gestureId,
			id: command.gestureId,
			operations,
			protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
			sequence: command.sequence,
			session,
		}
		const result = await options.batches
			.connect({ actor, session })
			.propose(proposal)
		if (result.status === `rejected`) {
			staged.delete(command.gestureId)
			throw new Error(result.rejection.reason)
		}
		return result.accepted as MosaicAcceptedDomainBatchEnvelope<Identity>
	}
	return {
		completeCompensation,
		get indexSummary() {
			return structuredClone(current.root.reference?.summary ?? null)
		},
		get instrumentation() {
			return { ...counters }
		},
		inspectRange,
		get length() {
			return current.root.reference?.summary.utf16Units ?? 0
		},
		materialize() {
			counters.materializations++
			return source().text
		},
		async positionAtOffset(offset) {
			const reader = createMosaicTextIndexReader(mosaicTextIndexSource(current))
			const lookup = await reader.positionAtOffset(offset)
			counters.memberLoads += Object.values(reader.counters).reduce(
				(total, value) => total + value,
				0,
			)
			return lookup
		},
		resolveIndexAlias(id, range) {
			return createMosaicTextIndexReader(
				mosaicTextIndexSource(current),
			).resolveAlias(id, range)
		},
		resolvePosition: (position) => source().resolvePosition(position),
		async resolveRange(range, limit) {
			const inspection = await inspectRange(range, limit)
			return inspection.leafIds.map(options.index.memberAddress)
		},
		submit(identity) {
			const result = commandTail.then(() => submitOne(identity))
			commandTail = result.then(
				() => undefined,
				() => undefined,
			)
			return result
		},
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			stopAccepted()
			staged.clear()
		},
	}
}
