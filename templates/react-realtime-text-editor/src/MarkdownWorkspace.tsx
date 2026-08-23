import { useMosaicTextRange } from "atom.io/realtime-react"
import type { MosaicTextRangeProjection } from "atom.io/realtime-client"
import {
	splitMosaicText,
	type MosaicTextRelativePosition,
} from "atom.io/realtime"
import {
	Fragment,
	createElement,
	type CSSProperties,
	type ReactElement,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"

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
import { SIMULATED_IDENTITIES } from "./identities.ts"
import {
	LexicalMarkdownEditor,
	type RenderedCollaboratorSelection,
} from "./LexicalMarkdownEditor.tsx"
import { transformSelectionAcrossTextChange } from "./lexical-linear-offset.ts"
import { switchBrowserIdentity } from "./session.ts"
import { markdownVirtualWindow } from "./virtualization.ts"
import css from "./MarkdownWorkspace.module.css"

type MarkdownWorkspaceProps = { readonly client: MarkdownCollaborationClient }
type PersonStyle = CSSProperties & Record<`--person-color`, string>
type SettledDraft = {
	readonly base: MosaicTextRangeProjection
	readonly requiredEnd: number
}
type RenderedProjection = {
	readonly projection: MosaicTextRangeProjection
	readonly selection: readonly [number, number] | null
}
type ResolvedRemoteSelections = {
	readonly projection: MosaicTextRangeProjection
	readonly selections: readonly ResolvedCollaboratorSelection[]
}
type ResolvedCollaboratorSelection = RenderedCollaboratorSelection & {
	readonly logicalKey: string
}
type DisplayedRemoteSelections = {
	readonly rangeStart: number
	readonly selections: readonly ResolvedCollaboratorSelection[]
	readonly text: string
}

const EMPTY_PARSE_METRICS: MarkdownParseInstrumentation = {
	canceled: false,
	elapsedMs: 0,
	parsedBlocks: 0,
	reusedBlocks: 0,
	scannedUtf16Units: 0,
	stableBoundaryIndex: null,
}
const WAITING_FOR_RESIDENT_SELECTION = Symbol(`waiting-for-resident-selection`)

function safeHref(candidate: string): string | undefined {
	return /^(https?:\/\/|mailto:|#)/u.test(candidate) ? candidate : undefined
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
	const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/gu
	const nodes: ReactNode[] = []
	let cursor = 0
	for (const match of text.matchAll(pattern)) {
		const index = match.index
		if (index > cursor) nodes.push(text.slice(cursor, index))
		const token = match[0]
		const key = `${keyPrefix}:${index}`
		if (token.startsWith(`\``)) {
			nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
		} else if (token.startsWith(`**`)) {
			nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
		} else if (token.startsWith(`*`)) {
			nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
		} else {
			const link = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(token)
			const href = safeHref(link?.[2] ?? ``)
			nodes.push(
				href ? (
					<a key={key} href={href} rel="noreferrer">
						{link?.[1]}
					</a>
				) : (
					<Fragment key={key}>{token}</Fragment>
				),
			)
		}
		cursor = index + token.length
	}
	if (cursor < text.length) nodes.push(text.slice(cursor))
	return nodes
}

function renderSemantic(block: MarkdownSemanticBlock): ReactElement {
	const content = renderInline(block.text, block.key)
	switch (block.kind) {
		case `heading`:
			return createElement(`h${block.level ?? 2}`, { key: block.key }, content)
		case `blockquote`:
			return <blockquote key={block.key}>{content}</blockquote>
		case `code`:
			return (
				<pre key={block.key}>
					<code>{block.text}</code>
				</pre>
			)
		case `list-item`:
			return <p key={block.key}>• {content}</p>
		case `paragraph`:
			return <p key={block.key}>{content}</p>
	}
}

function activePresence(
	client: MarkdownCollaborationClient,
): MarkdownPresence[] {
	return client.presence.state.presence.flatMap((envelope) =>
		envelope.kind === `update` && envelope.address.member === `collaborator`
			? [envelope.value as MarkdownPresence]
			: [],
	)
}

function statusLabel(
	status: MarkdownClientStatus,
	hasLocalDraft: boolean,
): string {
	if (status.connection === `offline`) return `Offline · draft stays local`
	if (status.connection === `recovering`) return `Resnapshotting working set…`
	if (status.connection === `connecting`) return `Connecting…`
	const pending = Math.max(status.pending, hasLocalDraft ? 1 : 0)
	return pending === 0
		? `All changes saved`
		: `Saving ${pending} gesture${pending === 1 ? `` : `s`}…`
}

const commonEdit = (before: string, after: string) => {
	let prefix = 0
	while (
		prefix < before.length &&
		prefix < after.length &&
		before[prefix] === after[prefix]
	) {
		prefix++
	}
	let suffix = 0
	while (
		suffix < before.length - prefix &&
		suffix < after.length - prefix &&
		before[before.length - suffix - 1] === after[after.length - suffix - 1]
	) {
		suffix++
	}
	return {
		end: before.length - suffix,
		start: prefix,
		text: after.slice(prefix, after.length - suffix),
	}
}

function resolvePositionInProjection(
	projection: MosaicTextRangeProjection,
	position: MosaicTextRelativePosition,
): number | null {
	if (position.runId === null) {
		return projection.range.start === 0 && projection.range.end === 0 ? 0 : null
	}
	for (const segment of projection.segments) {
		let utf16 = 0
		for (const fragment of segment.fragments) {
			if (fragment.runId === position.runId) {
				const graphemes = splitMosaicText(fragment.text)
				const local = position.offset - fragment.start
				if (local < 0) return null
				if (local === 0 && position.affinity === `right`) {
					return segment.start + utf16
				}
				if (local === graphemes.length && position.affinity === `left`) {
					return segment.start + utf16 + fragment.text.length
				}
				if (local > 0 && local < graphemes.length) {
					let localUtf16 = 0
					for (let index = 0; index < local; index++) {
						localUtf16 += graphemes[index].length
					}
					return segment.start + utf16 + localUtf16
				}
			}
			utf16 += fragment.text.length
		}
	}
	return null
}

function positionAtOffsetInProjection(
	projection: MosaicTextRangeProjection,
	absoluteOffset: number,
): MosaicTextRelativePosition | null {
	if (
		absoluteOffset === 0 &&
		projection.range.start === 0 &&
		projection.range.end === 0
	) {
		return { affinity: `left`, offset: 0, runId: null }
	}
	for (const segment of projection.segments) {
		if (absoluteOffset < segment.start || absoluteOffset > segment.end) continue
		let remaining = absoluteOffset - segment.start
		for (const fragment of segment.fragments) {
			const graphemes = splitMosaicText(fragment.text)
			let utf16 = 0
			for (let index = 0; index < graphemes.length; index++) {
				const next = utf16 + graphemes[index].length
				if (remaining < next) {
					return {
						affinity: `right`,
						offset: fragment.start + index,
						runId: fragment.runId,
					}
				}
				if (remaining === next) {
					return {
						affinity: `left`,
						offset: fragment.start + index + 1,
						runId: fragment.runId,
					}
				}
				utf16 = next
			}
			remaining -= utf16
		}
	}
	return null
}

export function MarkdownWorkspace({
	client,
}: MarkdownWorkspaceProps): ReactElement {
	const [status, setStatus] = useState(() => client.status())
	const [presence, setPresence] = useState(() => activePresence(client))
	const [totalLength, setTotalLength] = useState(0)
	const totalLengthRef = useRef(totalLength)
	totalLengthRef.current = totalLength
	const [scroll, setScroll] = useState({ height: 560, scrollTop: 0 })
	const [draft, setDraft] = useState<string | null>(null)
	const [localDirty, setLocalDirty] = useState(false)
	const [parse, setParse] = useState<readonly MarkdownSemanticBlock[]>([])
	const [parseMetrics, setParseMetrics] =
		useState<MarkdownParseInstrumentation>(EMPTY_PARSE_METRICS)
	const [resolvedRemoteSelections, setResolvedRemoteSelections] =
		useState<ResolvedRemoteSelections | null>(null)
	const resolvedRemoteSelectionsRef = useRef(resolvedRemoteSelections)
	resolvedRemoteSelectionsRef.current = resolvedRemoteSelections
	const displayedRemoteSelectionsRef = useRef<DisplayedRemoteSelections | null>(
		null,
	)
	const [readProblem, setReadProblem] = useState<string | null>(null)
	const [problem, setProblem] = useState<string | null>(null)
	const parser = useRef(new IncrementalMarkdownParser())
	const pendingDraft = useRef<{
		value: string
	} | null>(null)
	const pendingSelection = useRef<{
		anchorOffset: number
		headOffset: number
	} | null>(null)
	const resolvedPendingSelection = useRef<typeof pendingSelection.current>(null)
	const localSelectionPending = useRef(false)
	const committing = useRef(false)
	const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const deferredScroll = useRef<typeof scroll | null>(null)
	const window = useMemo(
		() =>
			markdownVirtualWindow(scroll, {
				averageUtf16UnitsPerRow: 88,
				overscanRows: 24,
				rowHeight: 24,
				totalUtf16Units: totalLength,
			}),
		[scroll, totalLength],
	)
	const view = useMosaicTextRange(client.projection, window.range, {
		overscan: 2_048,
	})
	const incomingProjection = view.status === `ready` ? view.projection : null
	const [renderedProjection, setRenderedProjection] =
		useState<RenderedProjection | null>(null)
	const logicalSelection = useRef<NonNullable<
		MarkdownPresence[`selection`]
	> | null>(null)
	const projection = renderedProjection?.projection ?? null
	const projectedSelection = renderedProjection?.selection ?? null
	const [settledDraft, setSettledDraft] = useState<SettledDraft | null>(null)
	const settledDraftRef = useRef<SettledDraft | null>(settledDraft)
	const projectionRef = useRef(projection)
	projectionRef.current = projection
	const displayed = draft ?? projection?.text ?? ``
	const displayedRemoteSelections = (() => {
		if (projection === null || resolvedRemoteSelections === null) {
			displayedRemoteSelectionsRef.current = null
			return []
		}
		const resolvedProjection = resolvedRemoteSelections.projection
		if (resolvedProjection.range.start !== projection.range.start) {
			displayedRemoteSelectionsRef.current = null
			return []
		}
		const previous = displayedRemoteSelectionsRef.current
		const selections = resolvedRemoteSelections.selections.map((selection) => {
			const optimistic =
				previous?.rangeStart === projection.range.start
					? previous.selections.find(
							(candidate) =>
								candidate.session === selection.session &&
								candidate.logicalKey === selection.logicalKey,
						)
					: undefined
			const source = optimistic ?? selection
			const sourceText =
				optimistic === undefined ? resolvedProjection.text : previous!.text
			if (sourceText === displayed)
				return { ...selection, end: source.end, start: source.start }
			const [start, end] = transformSelectionAcrossTextChange(
				sourceText,
				displayed,
				[source.start, source.end],
			)
			return { ...selection, end, start }
		})
		displayedRemoteSelectionsRef.current = {
			rangeStart: projection.range.start,
			selections,
			text: displayed,
		}
		return selections
	})()
	const publishPendingSelection = useCallback((): void => {
		const selection = pendingSelection.current
		const currentProjection = projectionRef.current
		if (
			selection === null ||
			currentProjection === null ||
			pendingDraft.current !== null ||
			settledDraftRef.current !== null
		) {
			return
		}
		if (
			!localSelectionPending.current &&
			resolvedPendingSelection.current === selection
		) {
			return
		}
		const anchorIndex = currentProjection.range.start + selection.anchorOffset
		const headIndex = currentProjection.range.start + selection.headOffset
		const residentAnchor = positionAtOffsetInProjection(
			currentProjection,
			anchorIndex,
		)
		const residentHead = positionAtOffsetInProjection(
			currentProjection,
			headIndex,
		)
		void Promise.all([
			residentAnchor ?? client.projection.positionAtOffset(anchorIndex),
			residentHead ?? client.projection.positionAtOffset(headIndex),
		]).then(([anchor, head]) => {
			// A later local selection or draft supersedes this asynchronous lookup.
			if (
				pendingSelection.current !== selection ||
				pendingDraft.current !== null ||
				settledDraftRef.current !== null
			) {
				return
			}
			const resolvedSelection = { anchor, head }
			resolvedPendingSelection.current = selection
			logicalSelection.current = resolvedSelection
			localSelectionPending.current = false
			return client.publishPresence({
				color: client.identity.color,
				name: client.identity.name,
				selection: resolvedSelection,
				viewport: null,
			})
		})
	}, [client])

	useEffect(() => {
		if (incomingProjection === null) return
		if (
			pendingDraft.current !== null ||
			settledDraftRef.current !== null ||
			localSelectionPending.current
		) {
			const localSelection = pendingSelection.current
			setRenderedProjection({
				projection: incomingProjection,
				selection:
					localSelection === null
						? null
						: [localSelection.anchorOffset, localSelection.headOffset],
			})
			return
		}
		const selection = logicalSelection.current
		if (selection === null) {
			setRenderedProjection({ projection: incomingProjection, selection: null })
			return
		}
		let active = true
		const residentAnchor = resolvePositionInProjection(
			incomingProjection,
			selection.anchor,
		)
		const residentHead = resolvePositionInProjection(
			incomingProjection,
			selection.head,
		)
		const resolved =
			residentAnchor === null || residentHead === null
				? Promise.all([
						client.projection.resolvePosition(selection.anchor),
						client.projection.resolvePosition(selection.head),
					])
				: Promise.resolve([residentAnchor, residentHead] as const)
		void resolved.then(([anchor, head]) => {
			if (!active || logicalSelection.current !== selection) return
			const start = incomingProjection.range.start
			const residentEnd = start + incomingProjection.text.length
			const previous = pendingSelection.current
			if (
				(residentAnchor === null || residentHead === null) &&
				previous !== null &&
				[anchor, head].some(
					(offset) => offset === start || offset === residentEnd,
				) &&
				[previous.anchorOffset, previous.headOffset].every(
					(offset) => offset !== 0 && offset !== incomingProjection.text.length,
				)
			) {
				return
			}
			if (
				[anchor, head].some(
					(offset) =>
						offset > residentEnd && offset <= incomingProjection.range.end,
				)
			) {
				return
			}
			const projectedSelection = {
				anchorOffset: Math.max(
					0,
					Math.min(incomingProjection.text.length, anchor - start),
				),
				headOffset: Math.max(
					0,
					Math.min(incomingProjection.text.length, head - start),
				),
			}
			pendingSelection.current = projectedSelection
			resolvedPendingSelection.current = projectedSelection
			setRenderedProjection({
				projection: incomingProjection,
				selection: [
					projectedSelection.anchorOffset,
					projectedSelection.headOffset,
				],
			})
		})
		return () => {
			active = false
		}
	}, [client, incomingProjection])

	const refreshLength = useCallback(async (): Promise<number | null> => {
		try {
			const length = await client.projection.readLength()
			totalLengthRef.current = length
			setTotalLength(length)
			setReadProblem(null)
			return length
		} catch (error) {
			setReadProblem(error instanceof Error ? error.message : String(error))
			return null
		}
	}, [client])

	const commitDraft = useCallback(async (): Promise<void> => {
		const pending = pendingDraft.current
		if (
			pending === null ||
			committing.current ||
			settledDraftRef.current !== null ||
			client.status().connection !== `live` ||
			projectionRef.current === null
		) {
			return
		}
		committing.current = true
		if (commitTimer.current !== null) {
			clearTimeout(commitTimer.current)
			commitTimer.current = null
		}
		try {
			const base = projectionRef.current
			if (base === null) return
			const coveredDocumentEnd = base.range.end >= totalLengthRef.current
			if (base.text !== pending.value) {
				const change = commonEdit(base.text, pending.value)
				const expectedRangeEnd = Math.max(
					base.range.start,
					base.range.end + pending.value.length - base.text.length,
				)
				const anchorOffset = base.range.start + change.start
				const headOffset = base.range.start + change.end
				const residentAnchor = positionAtOffsetInProjection(base, anchorOffset)
				const residentHead = positionAtOffsetInProjection(base, headOffset)
				const [anchor, head] = await Promise.all([
					residentAnchor ?? client.projection.positionAtOffset(anchorOffset),
					residentHead ?? client.projection.positionAtOffset(headOffset),
				])
				// Do not send an intermediate snapshot if the user changed it while
				// its logical anchors were being resolved. The newer draft will be
				// encoded against the next authoritative projection instead.
				if (pendingDraft.current !== pending) return
				await client.replace({
					selection: { anchor, head },
					text: change.text,
				})
				const authoritativeLength = await refreshLength()
				const settlement = {
					base,
					requiredEnd: coveredDocumentEnd
						? (authoritativeLength ?? expectedRangeEnd)
						: base.range.end,
				}
				settledDraftRef.current = settlement
				setSettledDraft(settlement)
				if (pendingDraft.current === pending) {
					pendingDraft.current = null
				}
				return
			}
			if (pendingDraft.current === pending) {
				pendingDraft.current = null
				setDraft(null)
				setLocalDirty(false)
				settledDraftRef.current = null
				setSettledDraft(null)
				if (deferredScroll.current !== null) {
					setScroll(deferredScroll.current)
					deferredScroll.current = null
				}
			}
			void refreshLength()
		} catch (error) {
			setProblem(error instanceof Error ? error.message : String(error))
		} finally {
			committing.current = false
			if (pendingDraft.current !== null && pendingDraft.current !== pending) {
				commitTimer.current = setTimeout(() => void commitDraft(), 120)
			}
		}
	}, [client, refreshLength])
	const scheduleCommit = useCallback((): void => {
		if (commitTimer.current !== null) clearTimeout(commitTimer.current)
		commitTimer.current = setTimeout(() => {
			commitTimer.current = null
			void commitDraft()
		}, 120)
	}, [commitDraft])

	useEffect(() => {
		if (
			settledDraft === null ||
			draft === null ||
			projection === null ||
			projection === settledDraft.base ||
			projection.range.start > settledDraft.base.range.start ||
			projection.range.end < settledDraft.requiredEnd ||
			projection.range.start + projection.text.length < settledDraft.requiredEnd
		) {
			return
		}
		settledDraftRef.current = null
		setSettledDraft(null)
		if (pendingDraft.current === null) {
			setDraft(null)
			setLocalDirty(false)
			if (deferredScroll.current !== null) {
				setScroll(deferredScroll.current)
				deferredScroll.current = null
			}
		} else {
			scheduleCommit()
		}
	}, [draft, projection, scheduleCommit, settledDraft])

	useEffect(() => {
		const stopStatus = client.subscribe((next) => {
			setStatus(next)
			if (next.connection === `live`) {
				scheduleCommit()
				void refreshLength()
			}
		})
		const stopPresence = client.presence.subscribe(() => {
			setPresence(activePresence(client))
		})
		void refreshLength()
		return () => {
			stopStatus()
			stopPresence()
			if (commitTimer.current !== null) clearTimeout(commitTimer.current)
			parser.current.cancel()
		}
	}, [client, refreshLength, scheduleCommit])

	useEffect(() => {
		if (projection === null) return
		const controller = new AbortController()
		void parser.current
			.parse(projection.blocks, { signal: controller.signal })
			.then((result) => {
				if (result.instrumentation.canceled) return
				setParse(result.blocks)
				setParseMetrics(result.instrumentation)
			})
		return () => controller.abort()
	}, [projection])

	useEffect(() => {
		if (projection === null || draft !== null) return
		if (pendingSelection.current !== null) {
			publishPendingSelection()
			return
		}
		const start = window.range.start
		const end = window.range.end
		void Promise.all([
			client.projection.positionAtOffset(start),
			client.projection.positionAtOffset(end),
		]).then(([anchor, head]) =>
			client.publishPresence({
				color: client.identity.color,
				name: client.identity.name,
				selection: null,
				viewport: { anchor, head },
			}),
		)
	}, [
		client,
		draft,
		projection,
		publishPendingSelection,
		window.range.end,
		window.range.start,
	])

	useEffect(() => {
		if (projection === null) {
			setResolvedRemoteSelections(null)
			return
		}
		let active = true
		const peers = presence.filter(
			(person) =>
				person.session !== client.sessionId && person.selection !== null,
		)
		void Promise.all(
			peers.map(async (person) => {
				try {
					const logicalKey = JSON.stringify(person.selection)
					const residentAnchor = resolvePositionInProjection(
						projection,
						person.selection!.anchor,
					)
					const residentHead = resolvePositionInProjection(
						projection,
						person.selection!.head,
					)
					const [anchor, head] =
						residentAnchor === null || residentHead === null
							? await Promise.all([
									client.projection.resolvePosition(person.selection!.anchor),
									client.projection.resolvePosition(person.selection!.head),
								])
							: [residentAnchor, residentHead]
					const absoluteStart = Math.min(anchor, head)
					const absoluteEnd = Math.max(anchor, head)
					const viewStart = projection.range.start
					const viewEnd = projection.range.end
					const residentEnd = viewStart + projection.text.length
					const previousState = resolvedRemoteSelectionsRef.current
					const previous = previousState?.selections.find(
						(selection) => selection.session === person.session,
					)
					if (
						(residentAnchor === null || residentHead === null) &&
						previous?.logicalKey === logicalKey
					) {
						const previousStart =
							previousState!.projection.range.start + previous.start
						const previousEnd =
							previousState!.projection.range.start + previous.end
						if (
							[anchor, head].some(
								(offset) => offset === viewStart || offset === residentEnd,
							) &&
							[previousStart, previousEnd].every(
								(offset) => offset !== viewStart && offset !== residentEnd,
							)
						) {
							return WAITING_FOR_RESIDENT_SELECTION
						}
					}
					if (
						absoluteStart === absoluteEnd
							? absoluteStart < viewStart || absoluteStart > viewEnd
							: absoluteEnd <= viewStart || absoluteStart >= viewEnd
					) {
						return null
					}
					if (absoluteEnd > residentEnd) {
						return WAITING_FOR_RESIDENT_SELECTION
					}
					return {
						color: person.color,
						end: Math.max(0, Math.min(projection.text.length, head - viewStart)),
						name: person.name,
						logicalKey,
						session: person.session,
						start: Math.max(
							0,
							Math.min(projection.text.length, anchor - viewStart),
						),
					} satisfies ResolvedCollaboratorSelection
				} catch {
					return null
				}
			}),
		).then((resolved) => {
			if (active && !resolved.includes(WAITING_FOR_RESIDENT_SELECTION)) {
				setResolvedRemoteSelections({
					projection,
					selections: resolved.filter(
						(item): item is ResolvedCollaboratorSelection =>
							item !== null && item !== WAITING_FOR_RESIDENT_SELECTION,
					),
				})
			}
		})
		return () => {
			active = false
		}
	}, [client, presence, projection])

	const publishSelection = (anchorOffset: number, headOffset: number): void => {
		const current = pendingSelection.current
		if (
			current?.anchorOffset === anchorOffset &&
			current.headOffset === headOffset
		) {
			return
		}
		pendingSelection.current = { anchorOffset, headOffset }
		publishPendingSelection()
	}

	return (
		<markdown-workspace className={css.class}>
			<header>
				<brand-lockup>
					<mark>M</mark>
					<label-set>
						<strong>Mosaic</strong>
						<span>Shared markdown</span>
					</label-set>
				</brand-lockup>
				<document-title>
					<strong>Launch field notes</strong>
					<span>{statusLabel(status, localDirty || draft !== null)}</span>
				</document-title>
				<toolbar-actions>
					<button type="button" onClick={() => void client.undo()}>
						↶ <span>Undo mine</span>
					</button>
					<button type="button" onClick={() => void client.redo()}>
						↷ <span>Redo</span>
					</button>
					<label>
						<avatar-dot
							style={{ "--person-color": client.identity.color } as PersonStyle}
						>
							{client.identity.name[0]}
						</avatar-dot>
						<select
							aria-label="Simulated identity"
							value={client.identity.id}
							onChange={(event) => switchBrowserIdentity(event.target.value)}
						>
							{SIMULATED_IDENTITIES.map((person) => (
								<option key={person.id} value={person.id}>
									{person.name}
								</option>
							))}
						</select>
					</label>
				</toolbar-actions>
			</header>
			<main>
				<editor-pane>
					<pane-heading>
						<label htmlFor="markdown-source">Markdown</label>
						<span>
							{totalLength.toLocaleString()} UTF-16 units · bounded viewport
						</span>
					</pane-heading>
					<editor-surface
						onScroll={(event) => {
							const element = event.currentTarget
							const nextScroll = {
								height: element.clientHeight,
								scrollTop: element.scrollTop,
							}
							if (pendingDraft.current !== null) {
								deferredScroll.current = nextScroll
								scheduleCommit()
							} else {
								setScroll(nextScroll)
							}
						}}
					>
						<virtual-spacer
							aria-hidden="true"
							style={{ height: window.topSpacer }}
						/>
						{view.status === `loading` ? <p>Hydrating viewport…</p> : null}
						{view.status === `error` ? (
							<p role="status">
								{status.connection === `offline`
									? `Waiting for the realtime backend…`
									: `Restoring the shared viewport…`}
							</p>
						) : null}
						{projection ? (
							<LexicalMarkdownEditor
								onDirty={() => {
									localSelectionPending.current = true
									setLocalDirty(true)
								}}
								onError={(error) => setProblem(error.message)}
								onRedo={() => void client.redo()}
								onSelectionChange={publishSelection}
								onUndo={() => void client.undo()}
								onValueChange={(value, composing) => {
									if (value === displayed) {
										if (pendingDraft.current === null) {
											localSelectionPending.current = false
											setLocalDirty(false)
										}
										if (!composing && pendingDraft.current !== null) {
											scheduleCommit()
										}
										return
									}
									localSelectionPending.current = true
									setDraft(value)
									pendingDraft.current = { value }
									if (!composing) scheduleCommit()
								}}
								selections={displayedRemoteSelections}
								selection={draft === null ? projectedSelection : null}
								value={displayed}
							/>
						) : null}
						<virtual-spacer
							aria-hidden="true"
							style={{ height: window.bottomSpacer }}
						/>
					</editor-surface>
				</editor-pane>
				<preview-pane>
					<pane-heading>
						<strong>Preview</strong>
						<span>
							{parseMetrics.parsedBlocks} parsed · {parseMetrics.reusedBlocks}
							{` `}
							reused
						</span>
					</pane-heading>
					<article>{parse.map(renderSemantic)}</article>
				</preview-pane>
				<presence-rail>
					<strong>In this viewport</strong>
					<ul>
						{presence.map((person) => (
							<li
								key={`${person.actor}:${person.session}`}
								data-self={person.session === client.sessionId}
							>
								<avatar-dot
									style={{ "--person-color": person.color } as PersonStyle}
								>
									{person.name[0]}
								</avatar-dot>
								<person-label>
									<strong>{person.name}</strong>
									<span>
										{person.session === client.sessionId
											? `You · local input`
											: person.selection
												? `Editing a logical position`
												: `Viewing another range`}
									</span>
								</person-label>
							</li>
						))}
					</ul>
					<aside>
						<strong>Bounded by design</strong>
						<p>
							Only this source and preview window is resident. Presence and
							selective history use logical run positions across splits.
						</p>
					</aside>
				</presence-rail>
			</main>
			<footer>
				<span data-status={status.connection} />
				<strong>{statusLabel(status, localDirty || draft !== null)}</strong>
				<small>
					Resident {client.residency.state.residentMemberCount} members
				</small>
				{(problem ?? readProblem ?? status.reason) ? (
					<output>{problem ?? readProblem ?? status.reason}</output>
				) : null}
			</footer>
		</markdown-workspace>
	)
}
