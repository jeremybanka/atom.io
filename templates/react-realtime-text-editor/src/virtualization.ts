import type { MosaicTextIndexRange } from "atom.io/realtime"

export type MarkdownVirtualMetrics = {
	readonly averageUtf16UnitsPerRow: number
	readonly overscanRows: number
	readonly rowHeight: number
	readonly totalUtf16Units: number
}

export type MarkdownVirtualWindow = {
	readonly bottomSpacer: number
	readonly range: MosaicTextIndexRange
	readonly topSpacer: number
}

/** Map a scroll viewport to a bounded logical range without a segment manifest. */
export function markdownVirtualWindow(
	viewport: { readonly height: number; readonly scrollTop: number },
	metrics: MarkdownVirtualMetrics,
): MarkdownVirtualWindow {
	for (const [name, value] of Object.entries({ ...viewport, ...metrics })) {
		if (!Number.isFinite(value) || value < 0) {
			throw new RangeError(`${name} must be a finite non-negative number.`)
		}
	}
	if (metrics.averageUtf16UnitsPerRow < 1 || metrics.rowHeight < 1) {
		throw new RangeError(`Virtual row estimates must be positive.`)
	}
	const totalRows = Math.max(
		1,
		Math.ceil(metrics.totalUtf16Units / metrics.averageUtf16UnitsPerRow),
	)
	const firstVisibleRow = Math.floor(viewport.scrollTop / metrics.rowHeight)
	const visibleRows = Math.max(1, Math.ceil(viewport.height / metrics.rowHeight))
	const firstRow = Math.max(0, firstVisibleRow - metrics.overscanRows)
	const lastRow = Math.min(
		totalRows,
		firstVisibleRow + visibleRows + metrics.overscanRows,
	)
	const start = Math.min(
		metrics.totalUtf16Units,
		Math.floor(firstRow * metrics.averageUtf16UnitsPerRow),
	)
	const end = Math.min(
		metrics.totalUtf16Units,
		Math.max(start, Math.ceil(lastRow * metrics.averageUtf16UnitsPerRow)),
	)
	return {
		bottomSpacer: Math.max(0, (totalRows - lastRow) * metrics.rowHeight),
		range: { end, kind: `utf16-range`, start },
		topSpacer: firstRow * metrics.rowHeight,
	}
}
