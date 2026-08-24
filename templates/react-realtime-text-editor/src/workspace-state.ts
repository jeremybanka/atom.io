import type { ReadonlyPureSelectorToken, RegularAtomToken, Silo } from "atom.io"
import type { MosaicTextSelection } from "atom.io/realtime"
import {
	createMosaicTextRangeController,
	type MosaicTextRangeController,
	type MosaicTextRangeView,
} from "atom.io/realtime-client"

import type {
	MarkdownClientStatus,
	MarkdownCollaborationClient,
} from "./collaboration-client.ts"
import type { MarkdownPresence } from "./document-domain.ts"
import {
	IncrementalMarkdownParser,
	type MarkdownParseInstrumentation,
	type MarkdownSemanticBlock,
} from "./incremental-markdown.ts"
import {
	markdownVirtualWindow,
	type MarkdownVirtualWindow,
} from "./virtualization.ts"

export type MarkdownScrollViewport = {
	readonly height: number
	readonly scrollTop: number
}

export type MarkdownWorkspacePeer = {
	readonly id: string
	readonly selection: MosaicTextSelection | null
	readonly value: MarkdownPresence
}

export type MarkdownWorkspaceState = Disposable & {
	readonly parse: RegularAtomToken<readonly MarkdownSemanticBlock[]>
	readonly parseMetrics: RegularAtomToken<MarkdownParseInstrumentation>
	readonly peers: ReadonlyPureSelectorToken<readonly MarkdownWorkspacePeer[]>
	readonly presence: RegularAtomToken<readonly MarkdownPresence[]>
	readonly problem: RegularAtomToken<string | null>
	readonly readProblem: RegularAtomToken<string | null>
	readonly scroll: RegularAtomToken<MarkdownScrollViewport>
	readonly status: RegularAtomToken<MarkdownClientStatus>
	readonly totalLength: RegularAtomToken<number>
	readonly view: RegularAtomToken<MosaicTextRangeView>
	readonly window: ReadonlyPureSelectorToken<MarkdownVirtualWindow>
	flushDeferredScroll(hasLocalDraft: boolean): void
	publishSelection(selection: MosaicTextSelection): Promise<void>
	publishViewport(viewport: MosaicTextSelection): Promise<void>
	refreshLength(): Promise<number | null>
	replace(
		input: Parameters<MarkdownCollaborationClient[`replace`]>[0],
	): Promise<void>
	reportEditorError(error: unknown): void
	setDocumentLength(length: number): void
	setScroll(viewport: MarkdownScrollViewport, defer: boolean): void
}

export const EMPTY_PARSE_METRICS: MarkdownParseInstrumentation = {
	canceled: false,
	elapsedMs: 0,
	parsedBlocks: 0,
	reusedBlocks: 0,
	scannedUtf16Units: 0,
	stableBoundaryIndex: null,
}

const activePresence = (
	client: MarkdownCollaborationClient,
): MarkdownPresence[] =>
	client.presence.state.presence.flatMap((envelope) =>
		envelope.kind === `update` && envelope.address.member === `collaborator`
			? [envelope.value as MarkdownPresence]
			: [],
	)

/** Store-owned application state around the renderer-neutral text controllers. */
export function createMarkdownWorkspaceState(options: {
	readonly client: MarkdownCollaborationClient
	readonly silo: Silo
}): MarkdownWorkspaceState {
	const { client, silo } = options
	const key = `markdown-workspace:${client.sessionId}`
	const statusAtom = silo.atom<MarkdownClientStatus>({
		default: client.status(),
		key: `status`,
	})
	const presenceAtom = silo.atom<readonly MarkdownPresence[]>({
		default: activePresence(client),
		key: `presence`,
	})
	const totalLengthAtom = silo.atom<number>({
		default: 0,
		key: `totalLength`,
	})
	const scrollAtom = silo.atom<MarkdownScrollViewport>({
		default: { height: 560, scrollTop: 0 },
		key: `scroll`,
	})
	const parseAtom = silo.atom<readonly MarkdownSemanticBlock[]>({
		default: [],
		key: `parse`,
	})
	const parseMetricsAtom = silo.atom<MarkdownParseInstrumentation>({
		default: EMPTY_PARSE_METRICS,
		key: `parseMetrics`,
	})
	const readProblemAtom = silo.atom<string | null>({
		default: null,
		key: `readProblem`,
	})
	const problemAtom = silo.atom<string | null>({
		default: null,
		key: `problem`,
	})
	const windowSelector = silo.selector<MarkdownVirtualWindow>({
		get: ({ get }) =>
			markdownVirtualWindow(get(scrollAtom), {
				averageUtf16UnitsPerRow: 88,
				overscanRows: 24,
				rowHeight: 24,
				totalUtf16Units: get(totalLengthAtom),
			}),
		key: `window`,
	})
	const peersSelector = silo.selector<readonly MarkdownWorkspacePeer[]>({
		get: ({ get }) =>
			get(presenceAtom)
				.filter((person) => person.session !== client.sessionId)
				.map((person) => ({
					id: person.session,
					selection: person.selection,
					value: person,
				})),
		key: `peers`,
	})
	const initialWindow = silo.getState(windowSelector)
	const range: MosaicTextRangeController = createMosaicTextRangeController({
		client: client.projection,
		initialRange: initialWindow.range,
		key: `${key}:text-range`,
		overscan: 2_048,
		silo,
	})
	const parser = new IncrementalMarkdownParser()
	let deferredScroll: MarkdownScrollViewport | null = null
	let disposed = false

	const refreshLength = async (): Promise<number | null> => {
		try {
			const length = await client.projection.readLength()
			if (disposed) return null
			silo.setState(totalLengthAtom, length)
			silo.setState(readProblemAtom, null)
			return length
		} catch (error) {
			if (!disposed) {
				silo.setState(
					readProblemAtom,
					error instanceof Error ? error.message : String(error),
				)
			}
			return null
		}
	}
	const parseProjection = (view: MosaicTextRangeView): void => {
		if (view.status !== `ready`) return
		void parser.parse(view.projection.blocks).then((result) => {
			if (disposed || result.instrumentation.canceled) return
			silo.setState(parseAtom, result.blocks)
			silo.setState(parseMetricsAtom, result.instrumentation)
		})
	}
	const stopStatus = client.subscribe((next) => {
		silo.setState(statusAtom, next)
		if (next.connection === `live`) void refreshLength()
	})
	const stopPresence = client.presence.subscribe(() => {
		silo.setState(presenceAtom, activePresence(client))
	})
	const stopWindow = silo.subscribe(windowSelector, ({ newValue }) => {
		silo.setState(range.range, newValue.range)
	})
	const stopView = silo.subscribe(range.view, ({ newValue }) => {
		parseProjection(newValue)
	})
	parseProjection(silo.getState(range.view))
	void refreshLength()

	return {
		parse: parseAtom,
		parseMetrics: parseMetricsAtom,
		peers: peersSelector,
		presence: presenceAtom,
		problem: problemAtom,
		readProblem: readProblemAtom,
		scroll: scrollAtom,
		status: statusAtom,
		totalLength: totalLengthAtom,
		view: range.view,
		window: windowSelector,
		flushDeferredScroll(hasLocalDraft) {
			if (hasLocalDraft || deferredScroll === null) return
			silo.setState(scrollAtom, deferredScroll)
			deferredScroll = null
		},
		publishSelection(selection) {
			return client.publishPresence({
				color: client.identity.color,
				name: client.identity.name,
				selection,
				viewport: null,
			})
		},
		publishViewport(viewport) {
			return client.publishPresence({
				color: client.identity.color,
				name: client.identity.name,
				selection: null,
				viewport,
			})
		},
		refreshLength,
		replace: (input) => client.replace(input),
		reportEditorError(error) {
			silo.setState(
				problemAtom,
				error instanceof Error ? error.message : String(error),
			)
		},
		setDocumentLength(length) {
			silo.setState(totalLengthAtom, length)
		},
		setScroll(viewport, defer) {
			if (defer) deferredScroll = viewport
			else silo.setState(scrollAtom, viewport)
		},
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			stopStatus()
			stopPresence()
			stopWindow()
			stopView()
			parser.cancel()
			range[Symbol.dispose]()
		},
	}
}
