import type {
	MosaicTextIndexRange,
	MosaicTextRelativePosition,
} from "atom.io/realtime"

export const MARKDOWN_EVENTS = {
	command: `markdown-domain:command`,
	materialize: `markdown-domain:materialize`,
	positionAtOffset: `markdown-domain:position-at-offset`,
	resolvePosition: `markdown-domain:resolve-position`,
} as const

export type MarkdownAcknowledgement<Value> =
	| { readonly ok: true; readonly value: Value }
	| { readonly ok: false; readonly reason: string }

export type MarkdownEditCommand = {
	readonly anchor: MosaicTextRelativePosition
	readonly gestureId: string
	readonly head: MosaicTextRelativePosition
	readonly sequence: number
	readonly text: string
	readonly type: `replace`
}

export type MarkdownImportCommand = {
	readonly gestureId: string
	readonly sequence: number
	readonly text: string
	readonly type: `import`
}

export type MarkdownCommand = MarkdownEditCommand | MarkdownImportCommand

export type MarkdownViewport = MosaicTextIndexRange
