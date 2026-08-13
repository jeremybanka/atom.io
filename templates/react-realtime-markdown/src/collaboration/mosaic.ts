import { mutableAtom, selector } from "atom.io"
import type { MosaicTextSelection } from "atom.io/realtime"
import { mosaicText } from "atom.io/realtime"

import { INITIAL_MARKDOWN } from "../initial-markdown.ts"

export type MarkdownPresence = {
	readonly color: string
	readonly lastActiveAt: number
	readonly name: string
	readonly selection: MosaicTextSelection | null
}

export const Markdown = mosaicText({
	initialText: INITIAL_MARKDOWN,
	maximumGraphemes: 200_000,
})

/** The collaborative document is an ordinary mutable atom. */
export const markdownAtom = mutableAtom<InstanceType<typeof Markdown>>({
	key: `launchFieldNotes`,
	class: Markdown,
})

/** Mosaic views participate in the state graph like every other atom value. */
export const markdownCharacterCountSelector = selector<number>({
	key: `launchFieldNotesCharacterCount`,
	get: ({ get }) => get(markdownAtom).length,
})

export const markdownWordCountSelector = selector<number>({
	key: `launchFieldNotesWordCount`,
	get: ({ get }) => {
		const text = get(markdownAtom).text.trim()
		return text === `` ? 0 : text.split(/\s+/u).length
	},
})

export function lineAndColumnAt(
	text: string,
	offset: number,
): { column: number; line: number } {
	const before = text.slice(0, offset)
	const lines = before.split(`\n`)
	return { column: lines.at(-1)?.length ?? 0, line: lines.length - 1 }
}
