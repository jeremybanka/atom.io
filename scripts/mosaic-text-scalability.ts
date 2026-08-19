import {
	compactMosaicTextHistory,
	createMosaicTextIndex,
	maintainMosaicTextIndex,
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
} from "../packages/atom.io/src/realtime/index.ts"
import {
	createMosaicDomainCheckpointCoordinator,
	InMemoryMosaicDomainCheckpointStorage,
} from "../packages/atom.io/src/realtime-server/index.ts"
import { MarkdownText } from "../templates/react-realtime-text-editor/src/document-domain.ts"

export const MOSAIC_TEXT_SCALE_FAULTS = Object.freeze([
	`duplicate`,
	`delay`,
	`reorder`,
	`reject`,
	`disconnect`,
	`restart`,
	`resnapshot`,
] as const)

export type MosaicTextScaleFault = (typeof MOSAIC_TEXT_SCALE_FAULTS)[number]

export type MosaicTextScaleDiagnostic = {
	readonly clientSchedule: readonly string[]
	readonly domainRevision: number
	readonly faultSchedule: readonly MosaicTextScaleFault[]
	readonly memberRevisions: Readonly<Record<string, number>>
	readonly residentRanges: readonly {
		readonly end: number
		readonly start: number
	}[]
	readonly seed: number
	readonly transcript: readonly string[]
}

const bytes = (value: unknown): number =>
	Buffer.byteLength(JSON.stringify(value))

export type MosaicTextStabilizationReport = {
	readonly checkpointBytes: number
	readonly checkpointObjects: number
	readonly compactedHistoryBytes: number
	readonly configuredHistorySteps: number
	readonly configuredReceiptWindow: number
	readonly elapsedMs: number
	readonly domainOperationReceipts: number
	readonly domainReceipts: number
	readonly domainSessionWatermarks: number
	readonly domainTailBatches: number
	readonly indexAliases: number
	readonly indexMembers: number
	readonly operations: number
	readonly retainedActions: number
	readonly retainedRuns: number
	readonly rssDeltaBytes: number
	readonly tailOperations: number
}

export async function stabilizeMosaicTextLifecycle(
	operations: number,
): Promise<MosaicTextStabilizationReport> {
	const text = stabilizeMosaicTextHistory(operations)
	const identity = {
		definition: { key: `mosaic-text-lifecycle-scale`, version: 3 },
		instance: `stabilization`,
	} as const
	const address = { domain: identity, key: `root`, member: `source` } as const
	const storage = new InMemoryMosaicDomainCheckpointStorage({
		maxRecentReceipts: text.configuredReceiptWindow,
		maxSessionWatermarks: 8,
	})
	let value = `a`
	const checkpoint = createMosaicDomainCheckpointCoordinator({
		domain: identity,
		readMember: () => value,
		storage,
	})
	const roots: `sha256:${string}`[] = []
	let maximumCheckpointBytes = 0
	for (let revision = 1; revision <= operations; revision++) {
		value = revision % 2 === 0 ? `a` : `b`
		const id = `stabilize:${revision}`
		const appended = await storage.appendBatch({
			accepted: {
				batch: {
					affectedMembers: [address],
					actor: `scale`,
					dependencies: revision === 1 ? [] : [`stabilize:${revision - 1}`],
					domain: identity,
					group: id,
					id,
					operations: [
						{
							address,
							id: `${id}:root`,
							model: { key: `mosaic-text-lifecycle`, version: 3 },
							operation: { type: `set`, value },
						},
					],
					protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
					sequence: revision,
					session: `scale`,
				},
				revision,
			},
			expectedRevision: revision - 1,
			fingerprint: id,
		})
		if (appended.status !== `accepted`) {
			throw new Error(`The Mosaic Domain lifecycle scale append failed.`)
		}
		if (revision % 128 === 0 || revision === operations) {
			const result = await checkpoint.checkpoint()
			maximumCheckpointBytes = Math.max(
				maximumCheckpointBytes,
				result.persistedBytes,
			)
			roots.push(result.rootKey)
			while (roots.length > 2) roots.shift()
			await storage.upsertCheckpointRetentionLease(identity, {
				id: `stabilization-history`,
				kind: `history`,
				minimumRevision: Math.max(0, revision - text.configuredHistorySteps),
				rootKeys: roots,
			})
			const head = await storage.checkpointHead(identity)
			const collected = await storage.collectCheckpointGarbage({
				domain: identity,
				expectedRetentionEpoch: head.retentionEpoch,
			})
			if (collected.status !== `collected`) {
				throw new Error(`The Mosaic Domain lifecycle GC fence became stale.`)
			}
		}
	}
	const stats = storage.stats(identity)
	if (
		stats.receiptCount > text.configuredReceiptWindow ||
		stats.operationReceiptCount > text.configuredReceiptWindow ||
		stats.sessionWatermarkCount > 1 ||
		stats.tailBatchCount > 256 ||
		stats.objectCount > 64
	) {
		throw new Error(
			`Mosaic Domain lifecycle retention did not stabilize: ${JSON.stringify(
				stats,
			)}`,
		)
	}
	return {
		...text,
		checkpointBytes: maximumCheckpointBytes,
		checkpointObjects: stats.objectCount,
		domainOperationReceipts: stats.operationReceiptCount,
		domainReceipts: stats.receiptCount,
		domainSessionWatermarks: stats.sessionWatermarkCount,
		domainTailBatches: stats.tailBatchCount,
	}
}

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

/** Exercise retention beyond 100k operations without retaining 100k objects. */
export function stabilizeMosaicTextHistory(
	operations: number,
	options: {
		readonly checkpointInterval?: number
		readonly historySteps?: number
	} = {},
): MosaicTextStabilizationReport {
	if (!Number.isSafeInteger(operations) || operations < 1) {
		throw new RangeError(`operations must be a positive safe integer.`)
	}
	const checkpointInterval = options.checkpointInterval ?? 128
	const historySteps = options.historySteps ?? 100
	const started = performance.now()
	const rssBefore = process.memoryUsage.rss()
	let text = new MarkdownText()
	let head: string | null = null
	let revision = 0
	const retained: string[] = []
	let index = createMosaicTextIndex([], INDEX_OPTIONS)
	let compactedHistoryBytes = 0
	for (let operation = 1; operation <= operations; operation++) {
		revision++
		const id = `stabilize:${operation}`
		text.do({
			actor: `scale`,
			dependencies: head === null ? [] : [head],
			group: id,
			id,
			operation: {
				deleted: text.runs.map(({ end, id: runId, start }) => ({
					end,
					runId,
					start,
				})),
				inserted: [
					{
						after: null,
						before: null,
						id: `${id}:run:000000`,
						text: operation % 2 === 0 ? `a` : `b`,
					},
				],
				type: `edit`,
			},
			revision,
			session: `scale`,
		})
		head = id
		retained.push(id)
		while (retained.length > historySteps) retained.shift()
		index = maintainMosaicTextIndex(
			index,
			text.runs.map(({ id: runId, start, text: value }) => ({
				runId,
				start,
				text: value,
			})),
			INDEX_OPTIONS,
		).index
		if (operation % checkpointInterval === 0 || operation === operations) {
			const compacted = compactMosaicTextHistory(
				text.toJSON(),
				new Set(retained),
				revision,
			)
			text = MarkdownText.fromJSON(compacted)
			compactedHistoryBytes = bytes(compacted)
		}
	}
	if (compactedHistoryBytes === 0)
		throw new Error(`Stabilization did not checkpoint.`)
	const snapshot = text.toJSON()
	const aliases = index.members.filter(({ kind }) => kind === `alias`).length
	const tailOperations = operations % checkpointInterval
	const report = {
		checkpointBytes: 0,
		checkpointObjects: 0,
		compactedHistoryBytes,
		configuredHistorySteps: historySteps,
		configuredReceiptWindow: 4_096,
		elapsedMs: performance.now() - started,
		domainOperationReceipts: 0,
		domainReceipts: 0,
		domainSessionWatermarks: 0,
		domainTailBatches: 0,
		indexAliases: aliases,
		indexMembers: index.members.length,
		operations,
		retainedActions: snapshot.actions.length,
		retainedRuns: snapshot.runs.length,
		rssDeltaBytes: Math.max(0, process.memoryUsage.rss() - rssBefore),
		tailOperations,
	} satisfies MosaicTextStabilizationReport
	if (
		report.retainedActions > historySteps + 4 ||
		report.retainedRuns > historySteps + 4 ||
		report.indexAliases > INDEX_OPTIONS.maximumAliasGenerations ||
		report.indexMembers > 16 ||
		report.compactedHistoryBytes > 1024 * 1024 ||
		report.tailOperations >= checkpointInterval
	) {
		throw new Error(
			`Mosaic Text retention did not stabilize: ${JSON.stringify(report)}`,
		)
	}
	return report
}

export function mosaicTextScaleFailure(
	error: unknown,
	diagnostic: MosaicTextScaleDiagnostic,
): Error {
	const message = error instanceof Error ? error.message : String(error)
	return new Error(
		`${message}\nMOSAIC_TEXT_SCALE_REPLAY=${JSON.stringify(diagnostic)}`,
		{ cause: error },
	)
}
