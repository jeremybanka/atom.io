import type {
	MosaicDomainHistoryRequest,
	MosaicTextIndexRange,
	MosaicTextRelativePosition,
} from "atom.io/realtime"

export const MARKDOWN_EVENTS = {
	accepted: `markdown-domain:accepted`,
	command: `markdown-domain:command`,
	history: `markdown-domain:history`,
	historySnapshot: `markdown-domain:history-snapshot`,
	hydrate: `markdown-domain:hydrate`,
	materialize: `markdown-domain:materialize`,
	positionAtOffset: `markdown-domain:position-at-offset`,
	recover: `markdown-domain:recover`,
	resolvePosition: `markdown-domain:resolve-position`,
	subscribe: `markdown-domain:subscribe`,
	unsubscribe: `markdown-domain:unsubscribe`,
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

export type MarkdownHistoryCommand = MosaicDomainHistoryRequest

export type MarkdownViewport = MosaicTextIndexRange
