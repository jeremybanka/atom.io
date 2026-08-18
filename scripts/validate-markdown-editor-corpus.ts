import fs from "node:fs/promises"

import { createMarkdownDocumentService } from "../templates/react-realtime-text-editor/node/service.ts"
import { IncrementalMarkdownParser } from "../templates/react-realtime-text-editor/src/incremental-markdown.ts"
import { markdownVirtualWindow } from "../templates/react-realtime-text-editor/src/virtualization.ts"

export type MarkdownCorpusValidation = {
	readonly documents: readonly {
		readonly bytes: number
		readonly composition: {
			readonly batchOperations: number
			readonly elapsedMs: number
			readonly leavesWritten: number
			readonly nodesWritten: number
			readonly revision: number
		}
		readonly maximumMountedBlocks: number
		readonly maximumScannedUtf16Units: number
		readonly samples: number
	}[]
}

const anchor = (offset: number) => ({
	affinity: `right` as const,
	offset,
	runId: `corpus`,
})

/**
 * Exercise the exact viewport/parser path against the canonical files. The
 * complete file remains one logical document; sampled ranges are renderer
 * residency windows, not application-authored document shards.
 */
export async function validateMarkdownEditorCorpus(
	paths: readonly string[],
): Promise<MarkdownCorpusValidation> {
	const documents = []
	for (const filename of paths) {
		const bytes = await fs.readFile(filename)
		const text = bytes.toString(`utf8`)
		const compositionStarted = performance.now()
		const service = await createMarkdownDocumentService({ initialText: text })
		const composition = {
			batchOperations: service.instrumentation.lastBatchOperations,
			elapsedMs: performance.now() - compositionStarted,
			leavesWritten: service.instrumentation.indexLeavesWritten,
			nodesWritten: service.instrumentation.indexNodesWritten,
			revision: service.revision,
		}
		try {
			if (
				composition.revision !== 1 ||
				composition.batchOperations > 65_536 ||
				service.instrumentation.materializations !== 0
			) {
				throw new Error(
					`Markdown corpus composition exceeded its Domain bounds.`,
				)
			}
			for (const offset of [0, Math.floor(text.length / 2), text.length]) {
				const lookup = await service.positionAtOffset(offset)
				if (lookup.leafId.length === 0) {
					throw new Error(
						`Markdown corpus index returned an empty leaf identity.`,
					)
				}
			}
		} finally {
			service[Symbol.dispose]()
		}
		const parser = new IncrementalMarkdownParser()
		let maximumMountedBlocks = 0
		let maximumScannedUtf16Units = 0
		const totalRows = Math.max(1, Math.ceil(text.length / 88))
		const scrollStops = [0, 0.5, 1]
		for (const stop of scrollStops) {
			const viewport = markdownVirtualWindow(
				{
					height: 720,
					scrollTop: stop * Math.max(0, totalRows * 24 - 720),
				},
				{
					averageUtf16UnitsPerRow: 88,
					overscanRows: 24,
					rowHeight: 24,
					totalUtf16Units: text.length,
				},
			)
			if (viewport.range.end - viewport.range.start > 65_536) {
				throw new Error(
					`A Markdown corpus viewport exceeded its residency bound.`,
				)
			}
			const windowText = text.slice(viewport.range.start, viewport.range.end)
			let cursor = viewport.range.start
			const blocks = windowText.split(`\n`).map((line, index) => {
				const start = cursor
				cursor += line.length + 1
				return {
					anchor: anchor(start),
					end: Math.min(text.length, cursor),
					key: `corpus:${start}:${index}`,
					start,
					text: line,
				}
			})
			const result = await parser.parse(blocks, {
				yieldAfterUtf16Units: 16_384,
			})
			maximumMountedBlocks = Math.max(maximumMountedBlocks, result.blocks.length)
			maximumScannedUtf16Units = Math.max(
				maximumScannedUtf16Units,
				result.instrumentation.scannedUtf16Units,
			)
		}
		documents.push({
			bytes: bytes.byteLength,
			composition,
			maximumMountedBlocks,
			maximumScannedUtf16Units,
			samples: scrollStops.length,
		})
	}
	return { documents }
}
