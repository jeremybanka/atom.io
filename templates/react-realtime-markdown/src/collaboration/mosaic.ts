import type { MosaicTextSelection, MosaicTextTimeline } from "atom.io/realtime"
import { defineMosaicResource, mosaicText } from "atom.io/realtime"
import type { MosaicClientHistoryAdapter } from "atom.io/realtime-client"

import { INITIAL_MARKDOWN } from "../initial-markdown.ts"

export type MarkdownPresence = {
	readonly color: string
	readonly lastActiveAt: number
	readonly name: string
	readonly selection: MosaicTextSelection | null
}

export const markdownModel = mosaicText({
	initialText: INITIAL_MARKDOWN,
	maximumGraphemes: 200_000,
})

export const markdownResource = defineMosaicResource({
	key: `launch-field-notes`,
	model: markdownModel,
})

export const markdownHistory = {
	intent: (mode) => ({ type: mode }),
	read: (state, actor) => markdownModel.timeline(state, actor),
} satisfies MosaicClientHistoryAdapter<typeof markdownModel, MosaicTextTimeline>

export function lineAndColumnAt(
	text: string,
	offset: number,
): { column: number; line: number } {
	const before = text.slice(0, offset)
	const lines = before.split(`\n`)
	return { column: lines.at(-1)?.length ?? 0, line: lines.length - 1 }
}
