import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { IncrementalMarkdownParser } from "../templates/react-realtime-text-editor/src/incremental-markdown.ts"
import { markdownVirtualWindow } from "../templates/react-realtime-text-editor/src/virtualization.ts"
import {
	type MosaicTextRootScaleClient,
	type MosaicTextRootScaleEdit,
	MosaicTextRootScaleService,
} from "./mosaic-text-root-scale-service.ts"
import {
	MOSAIC_TEXT_SCALE_FAULTS,
	type MosaicTextScaleDiagnostic,
	mosaicTextScaleFailure,
	type MosaicTextStabilizationReport,
	stabilizeMosaicTextLifecycle,
} from "./mosaic-text-scalability.ts"

export type MarkdownCorpusValidation = {
	readonly documents: readonly {
		readonly bytes: number
		readonly convergence: {
			readonly clientRevisions: Readonly<Record<string, number>>
			readonly digest: string
			readonly domainRevision: number
			readonly faultSteps: number
			readonly frontierBatchId: string
			readonly history: Readonly<Record<string, { redo: number; undo: number }>>
			readonly indexSummary: {
				readonly graphemes: number
				readonly lineBreaks: number
				readonly utf16Units: number
			}
			readonly residentRanges: Readonly<
				Record<string, readonly { end: number; start: number }[]>
			>
			readonly rootKey: string
			readonly transcript: readonly string[]
		}
		readonly import: {
			readonly branchesWritten: number
			readonly leavesWritten: number
			readonly persistedBytes: number
			readonly utf16Scanned: number
		}
		readonly local: {
			readonly checkpointBytes: number
			readonly leavesVisited: number
			readonly leavesWritten: number
			readonly memberLoads: number
			readonly nodesVisited: number
			readonly nodesWritten: number
			readonly persistedBytes: number
			readonly serializedBatchBytes: number
			readonly utf16Scanned: number
			readonly validationHashedBytes: number
			readonly validationObjectReads: number
			readonly validationSerializedBytes: number
		}
		readonly maximumDeliveredBytes: number
		readonly maximumFullDocumentReplicas: number
		readonly maximumMountedBlocks: number
		readonly maximumResidentBytes: number
		readonly maximumScannedUtf16Units: number
		readonly name: string
		readonly observations: {
			readonly elapsedMs: number
			readonly rssDeltaBytes: number
		}
		readonly samples: number
		readonly selectorInvalidations: number
	}[]
	readonly faultSchedule: typeof MOSAIC_TEXT_SCALE_FAULTS
	readonly seed: number
	readonly stabilization: MosaicTextStabilizationReport
}

export type MarkdownCorpusValidationOptions = {
	readonly seed?: number
	readonly stabilizationOperations?: number
	readonly timeoutMsPerDocument?: number
}

const anchor = (offset: number) => ({
	affinity: `right` as const,
	offset,
	runId: `mosaic-text-root:v3`,
})

type OraclePiece =
	| { readonly end: number; readonly kind: `source`; readonly start: number }
	| { readonly kind: `inserted`; readonly text: string }

const oraclePieceLength = (piece: OraclePiece): number =>
	piece.kind === `source` ? piece.end - piece.start : piece.text.length

const sliceOraclePiece = (
	piece: OraclePiece,
	start: number,
	end: number,
): OraclePiece =>
	piece.kind === `source`
		? { end: piece.start + end, kind: `source`, start: piece.start + start }
		: { kind: `inserted`, text: piece.text.slice(start, end) }

/** Hash the piece-table oracle without ever materializing the source document. */
const digestOracle = async (
	filename: string,
	pieces: readonly OraclePiece[],
): Promise<string> => {
	const hash = createHash(`sha256`)
	const stream = createReadStream(filename, {
		encoding: `utf8`,
		highWaterMark: 128 * 1024,
	})
	const iterator = stream[Symbol.asyncIterator]()
	let chunk = ``
	let chunkOffset = 0
	let sourceOffset = 0
	const consumeThrough = async (
		target: number,
		write: boolean,
	): Promise<void> => {
		if (!Number.isSafeInteger(target) || target < sourceOffset) {
			throw new Error(`A scale oracle source range is invalid.`)
		}
		while (sourceOffset < target) {
			if (chunkOffset === chunk.length) {
				const next = await iterator.next()
				if (next.done) {
					throw new Error(`The scale oracle exceeded its canonical source.`)
				}
				chunk =
					typeof next.value === `string`
						? next.value
						: (next.value as Buffer).toString(`utf8`)
				chunkOffset = 0
			}
			const length = Math.min(target - sourceOffset, chunk.length - chunkOffset)
			if (write) hash.update(chunk.slice(chunkOffset, chunkOffset + length))
			chunkOffset += length
			sourceOffset += length
		}
	}
	try {
		for (const piece of pieces) {
			if (piece.kind === `inserted`) {
				hash.update(piece.text)
				continue
			}
			await consumeThrough(piece.start, false)
			await consumeThrough(piece.end, true)
		}
		return hash.digest(`hex`)
	} finally {
		stream.destroy()
	}
}

const splitPieces = (
	pieces: readonly OraclePiece[],
	offset: number,
): readonly [readonly OraclePiece[], readonly OraclePiece[]] => {
	const left: OraclePiece[] = []
	const right: OraclePiece[] = []
	let cursor = 0
	let split = false
	for (const piece of pieces) {
		if (split) {
			right.push(piece)
			continue
		}
		const pieceLength = oraclePieceLength(piece)
		const end = cursor + pieceLength
		if (offset > end) {
			left.push(piece)
			cursor = end
			continue
		}
		const local = offset - cursor
		if (local > 0) left.push(sliceOraclePiece(piece, 0, local))
		if (local < pieceLength) {
			right.push(sliceOraclePiece(piece, local, pieceLength))
		}
		split = true
	}
	if (!split && offset !== cursor) {
		throw new RangeError(`A scale oracle split is out of bounds.`)
	}
	return [left, right]
}

const applyOracleEdit = (
	pieces: readonly OraclePiece[],
	edit: MosaicTextRootScaleEdit,
): readonly OraclePiece[] => {
	const [before, suffix] = splitPieces(pieces, edit.start)
	const [_deleted, after] = splitPieces(suffix, edit.end - edit.start)
	return edit.inserted.length === 0
		? [...before, ...after]
		: [...before, { kind: `inserted`, text: edit.inserted }, ...after]
}

const digestService = async (
	service: MosaicTextRootScaleService,
): Promise<string> => {
	const hash = createHash(`sha256`)
	for (let start = 0; start < service.length; start += 64 * 1024) {
		hash.update(
			await service.readRange(
				start,
				Math.min(service.length, start + 64 * 1024),
			),
		)
	}
	return hash.digest(`hex`)
}

const inspectParser = async (
	service: MosaicTextRootScaleService,
	client: MosaicTextRootScaleClient,
): Promise<{
	maximumMountedBlocks: number
	maximumScannedUtf16Units: number
	samples: number
}> => {
	const parser = new IncrementalMarkdownParser()
	let maximumMountedBlocks = 0
	let maximumScannedUtf16Units = 0
	const totalRows = Math.max(1, Math.ceil(service.length / 88))
	for (const stop of [0, 0.5, 1]) {
		const viewport = markdownVirtualWindow(
			{
				height: 720,
				scrollTop: stop * Math.max(0, totalRows * 24 - 720),
			},
			{
				averageUtf16UnitsPerRow: 88,
				overscanRows: 24,
				rowHeight: 24,
				totalUtf16Units: service.length,
			},
		)
		if (viewport.range.end - viewport.range.start > 65_536) {
			throw new Error(`A Markdown viewport exceeded its residency bound.`)
		}
		const projection = await client.hydrate(
			viewport.range.start,
			viewport.range.end,
		)
		let cursor = viewport.range.start
		const blocks = projection.text.split(`\n`).map((text, index) => {
			const start = cursor
			cursor += text.length + 1
			return {
				anchor: anchor(start),
				end: Math.min(service.length, cursor),
				key: `root-v3:${start}:${index}`,
				start,
				text,
			}
		})
		const parsed = await parser.parse(blocks, {
			yieldAfterUtf16Units: 16_384,
		})
		maximumMountedBlocks = Math.max(maximumMountedBlocks, parsed.blocks.length)
		maximumScannedUtf16Units = Math.max(
			maximumScannedUtf16Units,
			parsed.instrumentation.scannedUtf16Units,
		)
	}
	return {
		maximumMountedBlocks,
		maximumScannedUtf16Units,
		samples: 3,
	}
}

const validateBounds = (
	service: MosaicTextRootScaleService,
	parser: Awaited<ReturnType<typeof inspectParser>>,
): void => {
	const { metrics } = service
	if (
		metrics.maximumLocalCounters.objectReads > 12 ||
		metrics.maximumLocalCounters.leavesVisited > 8 ||
		metrics.maximumLocalCounters.leavesWritten > 6 ||
		metrics.maximumLocalCounters.branchesVisited > 4 ||
		metrics.maximumLocalCounters.branchesWritten > 10 ||
		metrics.maximumLocalCounters.utf16Scanned > 768 * 1024 ||
		metrics.maximumLocalExternalPersistedBytes > 4 * 1024 * 1024 ||
		metrics.maximumMemberLoads > 256 ||
		metrics.maximumLocalValidationObjectReads > 256 ||
		metrics.maximumLocalValidationHashedBytes > 2 * 1024 * 1024 ||
		metrics.maximumLocalValidationSerializedBytes > 2 * 1024 * 1024 ||
		metrics.maximumFullDocumentReplicas > 1 ||
		metrics.serializedBatchBytes > 32 * 1024 ||
		metrics.maximumResidentBytes > 256 * 1024 ||
		parser.maximumScannedUtf16Units > 65_536
	) {
		throw new Error(
			`Mosaic Text v3 exceeded a deterministic local bound: ${JSON.stringify(
				metrics,
			)}`,
		)
	}
}

async function validateDocument(
	filename: string,
	seed: number,
	timeoutMs: number,
): Promise<MarkdownCorpusValidation[`documents`][number]> {
	const started = performance.now()
	const deadline = started + timeoutMs
	const assertBeforeDeadline = (phase: string): void => {
		if (performance.now() > deadline) {
			throw new Error(`Mosaic Text v3 exceeded its deadline during ${phase}.`)
		}
	}
	const rssBefore = process.memoryUsage.rss()
	const transcript: string[] = []
	let service: MosaicTextRootScaleService | undefined
	try {
		service = await MosaicTextRootScaleService.open(filename, { deadline })
		const sourceUtf16Units = service.length
		assertBeforeDeadline(`import`)
		const importMetrics = service.metrics
		const ada = service.connect(`ada`)
		const lin = service.connect(`lin`)
		const ranges = [
			{ end: Math.min(service.length, 4_096), start: 0 },
			{
				end: Math.min(service.length, Math.floor(service.length / 2) + 2_048),
				start: Math.max(0, Math.floor(service.length / 2) - 2_048),
			},
			{ end: service.length, start: Math.max(0, service.length - 4_096) },
		]
		await Promise.all(
			ranges.flatMap(({ end, start }) => [
				ada.hydrate(start, end),
				lin.hydrate(start, end),
			]),
		)
		assertBeforeDeadline(`join`)
		transcript.push(`join:viewport-only`)

		const disjointStart = await service.resolveBoundary(
			Math.min(service.length, 1_024),
			`left`,
		)
		const disjointEnd = await service.resolveBoundary(
			Math.min(service.length, 1_032),
			`right`,
		)
		await ada.commit({
			end: disjointEnd,
			id: `scale:ada:disjoint`,
			inserted: `[ada-disjoint]`,
			start: disjointStart,
		})
		const tailStart = await service.resolveBoundary(
			Math.max(0, service.length - 1_032),
			`left`,
		)
		const tailEnd = await service.resolveBoundary(
			Math.min(service.length, tailStart + 8),
			`right`,
		)
		await lin.commit({
			end: tailEnd,
			id: `scale:lin:disjoint`,
			inserted: `[lin-disjoint]`,
			start: tailStart,
		})
		transcript.push(`multi-client:disjoint-viewports`)

		const delayed = service.connect(`delayed`)
		service.disconnect(delayed)
		const boundary = await service.resolveBoundary(
			Math.floor(service.length / 2),
			`left`,
		)
		const firstBoundary = await ada.commit({
			end: boundary,
			id: `scale:ada:boundary`,
			inserted: `[ada]`,
			start: boundary,
		})
		const secondBoundary = await lin.commit({
			end: boundary,
			id: `scale:lin:boundary`,
			inserted: `[lin]`,
			start: boundary,
		})
		delayed.deliver(secondBoundary)
		delayed.deliver(secondBoundary)
		delayed.deliver(firstBoundary)
		if (delayed.revision !== service.revision) {
			throw new Error(`A delayed/reordered client did not converge.`)
		}
		transcript.push(`duplicate/delay/reorder:shared-boundary`)
		assertBeforeDeadline(`contention`)

		const crossStart = await service.resolveBoundary(
			Math.max(0, Math.min(service.length, 32_740)),
			`left`,
		)
		const crossEnd = await service.resolveBoundary(
			Math.min(service.length, crossStart + 96),
			`right`,
		)
		await ada.commit({
			end: crossEnd,
			id: `scale:ada:cross-leaf`,
			inserted: `[cross-leaf-paste]`,
			start: crossStart,
		})
		await lin.commit({
			end: service.length,
			id: `scale:lin:foreign`,
			inserted: `[foreign]`,
			start: service.length,
		})
		const revisionBeforeRejection = service.revision
		await service
			.replace({
				actor: `lin`,
				end: 0,
				id: `scale:rejected`,
				inserted: `x`.repeat(256 * 1024 + 1),
				start: 0,
			})
			.then(
				() => {
					throw new Error(`An oversized edit was accepted.`)
				},
				() => undefined,
			)
		if (service.revision !== revisionBeforeRejection) {
			throw new Error(`Rejected work changed the Domain revision.`)
		}
		transcript.push(`reject:operation-safety-limit`)

		await ada.undo(`scale:history:undo`)
		await ada.redo(`scale:history:redo`)
		if (
			!(await service.readRange(service.length - 9, service.length)).includes(
				`[foreign]`,
			)
		) {
			throw new Error(`Selective history erased a foreign edit.`)
		}
		transcript.push(`history:individual-foreign-safe-undo-redo`)
		assertBeforeDeadline(`history`)

		service.disconnect(lin)
		await ada.commit({
			end: 0,
			id: `scale:ada:offline`,
			inserted: `[offline]`,
			start: 0,
		})
		lin.resnapshot()
		if (lin.revision !== service.revision) {
			throw new Error(`A disconnected client did not resnapshot.`)
		}
		transcript.push(`disconnect/stale-root/resnapshot:bounded-root`)

		const middle = {
			end: Math.min(service.length, Math.floor(service.length / 2) + 1_024),
			start: Math.max(0, Math.floor(service.length / 2) - 1_024),
		}
		const beforeEviction = await ada.hydrate(middle.start, middle.end)
		await ada.hydrate(0, Math.min(service.length, 2_048))
		await ada.hydrate(Math.max(0, service.length - 2_048), service.length)
		const reacquired = await ada.hydrate(middle.start, middle.end)
		if (reacquired.text !== beforeEviction.text) {
			throw new Error(`Evicted range reacquisition did not converge.`)
		}
		transcript.push(`partial-hydration:evict/reacquire`)
		transcript.push(`split/merge:path-copy-boundary-race`)

		await service.restart()
		ada.resnapshot()
		lin.resnapshot()
		delayed.resnapshot()
		if (
			ada.revision !== service.revision ||
			lin.revision !== service.revision ||
			delayed.revision !== service.revision
		) {
			throw new Error(`Clients did not converge after restart.`)
		}
		transcript.push(`restart:domain-root-and-frontier`)
		assertBeforeDeadline(`restart`)

		const parser = await inspectParser(service, ada)
		assertBeforeDeadline(`parser`)
		const publication = service.publication
		const frontierBatchId = service.frontierBatchId
		const indexSummary = publication.root.reference?.summary
		if (frontierBatchId === null || indexSummary === undefined) {
			throw new Error(`The final Mosaic Text v3 frontier is incomplete.`)
		}
		for (const client of [ada, lin, delayed]) {
			if (
				client.revision !== service.revision ||
				client.publication?.externalRoot !== publication.externalRoot
			) {
				throw new Error(`A client frontier or root did not converge.`)
			}
		}
		let oracle: readonly OraclePiece[] = [
			{ end: sourceUtf16Units, kind: `source`, start: 0 },
		]
		for (const edit of service.edits) oracle = applyOracleEdit(oracle, edit)
		const expectedDigest = await digestOracle(filename, oracle)
		oracle = []
		Bun.gc(true)
		const actualDigest = await digestService(service)
		assertBeforeDeadline(`convergence digest`)
		if (actualDigest !== expectedDigest) {
			throw new Error(`Mosaic Text v3 did not converge with its flat oracle.`)
		}
		validateBounds(service, parser)
		const metrics = service.metrics
		return {
			bytes: (await fs.stat(filename)).size,
			convergence: {
				clientRevisions: {
					ada: ada.revision,
					delayed: delayed.revision,
					lin: lin.revision,
				},
				digest: actualDigest,
				domainRevision: service.revision,
				faultSteps: MOSAIC_TEXT_SCALE_FAULTS.length,
				frontierBatchId,
				history: {
					ada: ada.history,
					lin: lin.history,
				},
				indexSummary,
				residentRanges: {
					ada: ada.residentRanges,
					delayed: delayed.residentRanges,
					lin: lin.residentRanges,
				},
				rootKey: publication.externalRoot,
				transcript: [...service.transcript, ...transcript],
			},
			import: {
				branchesWritten: importMetrics.importCounters.branchesWritten,
				leavesWritten: importMetrics.importCounters.leavesWritten,
				persistedBytes: importMetrics.initialExternalPersistedBytes,
				utf16Scanned: importMetrics.importCounters.utf16Scanned,
			},
			local: {
				checkpointBytes: metrics.checkpointBytes,
				leavesVisited: metrics.maximumLocalCounters.leavesVisited,
				leavesWritten: metrics.maximumLocalCounters.leavesWritten,
				memberLoads: metrics.maximumMemberLoads,
				nodesVisited: metrics.maximumLocalCounters.branchesVisited,
				nodesWritten: metrics.maximumLocalCounters.branchesWritten,
				persistedBytes: metrics.maximumLocalExternalPersistedBytes,
				serializedBatchBytes: metrics.serializedBatchBytes,
				utf16Scanned: metrics.maximumLocalCounters.utf16Scanned,
				validationHashedBytes: metrics.maximumLocalValidationHashedBytes,
				validationObjectReads: metrics.maximumLocalValidationObjectReads,
				validationSerializedBytes: metrics.maximumLocalValidationSerializedBytes,
			},
			maximumDeliveredBytes: metrics.deliveredBytes,
			maximumFullDocumentReplicas: metrics.maximumFullDocumentReplicas,
			maximumMountedBlocks: parser.maximumMountedBlocks,
			maximumResidentBytes: metrics.maximumResidentBytes,
			maximumScannedUtf16Units: parser.maximumScannedUtf16Units,
			name: path.basename(filename),
			observations: {
				elapsedMs: performance.now() - started,
				rssDeltaBytes: Math.max(0, process.memoryUsage.rss() - rssBefore),
			},
			samples: parser.samples,
			selectorInvalidations: metrics.selectorInvalidations,
		}
	} catch (error) {
		const diagnostic: MosaicTextScaleDiagnostic = {
			clientSchedule: [`ada:first`, `lin:last`, `ada:middle`, `lin:middle`],
			domainRevision: service?.revision ?? 0,
			faultSchedule: MOSAIC_TEXT_SCALE_FAULTS,
			memberRevisions: { source: service?.revision ?? 0 },
			residentRanges: [],
			seed,
			transcript: [...(service?.transcript ?? []), ...transcript],
		}
		throw mosaicTextScaleFailure(error, diagnostic)
	}
}

/** Run real corpus payloads sequentially with one authoritative graph at a time. */
export async function validateMarkdownEditorCorpus(
	paths: readonly string[],
	options: MarkdownCorpusValidationOptions = {},
): Promise<MarkdownCorpusValidation> {
	const seed = options.seed ?? 0x21_50_00
	const timeoutMs = options.timeoutMsPerDocument ?? 180_000
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
		throw new RangeError(`timeoutMsPerDocument must be a positive safe integer.`)
	}
	const documents = []
	for (const filename of paths) {
		documents.push(await validateDocument(filename, seed, timeoutMs))
		Bun.gc(true)
	}
	return {
		documents,
		faultSchedule: MOSAIC_TEXT_SCALE_FAULTS,
		seed,
		stabilization: await stabilizeMosaicTextLifecycle(
			options.stabilizationOperations ?? 100_001,
		),
	}
}
