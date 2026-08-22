import { useMosaicTextRange } from "atom.io/realtime-react"
import type { MosaicTextRangeProjection } from "atom.io/realtime-client"
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

const EMPTY_PARSE_METRICS: MarkdownParseInstrumentation = {
	canceled: false,
	elapsedMs: 0,
	parsedBlocks: 0,
	reusedBlocks: 0,
	scannedUtf16Units: 0,
	stableBoundaryIndex: null,
}

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

function statusLabel(status: MarkdownClientStatus): string {
	if (status.connection === `offline`) return `Offline · draft stays local`
	if (status.connection === `recovering`) return `Resnapshotting working set…`
	if (status.connection === `connecting`) return `Connecting…`
	return status.pending === 0
		? `All changes saved`
		: `Saving ${status.pending} gesture${status.pending === 1 ? `` : `s`}…`
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
	const [parse, setParse] = useState<readonly MarkdownSemanticBlock[]>([])
	const [parseMetrics, setParseMetrics] =
		useState<MarkdownParseInstrumentation>(EMPTY_PARSE_METRICS)
	const [remoteSelections, setRemoteSelections] = useState<
		readonly RenderedCollaboratorSelection[]
	>([])
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
		if (resolvedPendingSelection.current === selection) return
		const anchorIndex = currentProjection.range.start + selection.anchorOffset
		const headIndex = currentProjection.range.start + selection.headOffset
		void Promise.all([
			client.projection.positionAtOffset(anchorIndex),
			client.projection.positionAtOffset(headIndex),
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
		const selection = logicalSelection.current
		if (selection === null) {
			setRenderedProjection({ projection: incomingProjection, selection: null })
			return
		}
		let active = true
		void Promise.all([
			client.projection.resolvePosition(selection.anchor),
			client.projection.resolvePosition(selection.head),
		]).then(([anchor, head]) => {
			if (!active || logicalSelection.current !== selection) return
			const start = incomingProjection.range.start
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
				const [anchor, head] = await Promise.all([
					client.projection.positionAtOffset(base.range.start + change.start),
					client.projection.positionAtOffset(base.range.start + change.end),
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
			setRemoteSelections([])
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
					const [anchor, head] = await Promise.all([
						client.projection.resolvePosition(person.selection!.anchor),
						client.projection.resolvePosition(person.selection!.head),
					])
					const absoluteStart = Math.min(anchor, head)
					const absoluteEnd = Math.max(anchor, head)
					const viewStart = projection.range.start
					const viewEnd = projection.range.end
					if (
						absoluteStart === absoluteEnd
							? absoluteStart < viewStart || absoluteStart > viewEnd
							: absoluteEnd <= viewStart || absoluteStart >= viewEnd
					) {
						return null
					}
					return {
						color: person.color,
						end: Math.max(0, Math.min(projection.text.length, head - viewStart)),
						name: person.name,
						session: person.session,
						start: Math.max(
							0,
							Math.min(projection.text.length, anchor - viewStart),
						),
					} satisfies RenderedCollaboratorSelection
				} catch {
					return null
				}
			}),
		).then((resolved) => {
			if (active) setRemoteSelections(resolved.filter((item) => item !== null))
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
					<span>{statusLabel(status)}</span>
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
								onError={(error) => setProblem(error.message)}
								onRedo={() => void client.redo()}
								onSelectionChange={publishSelection}
								onUndo={() => void client.undo()}
								onValueChange={(value, composing) => {
									if (value === displayed) {
										if (!composing && pendingDraft.current !== null) {
											scheduleCommit()
										}
										return
									}
									setDraft(value)
									pendingDraft.current = { value }
									if (!composing) scheduleCommit()
								}}
								selections={remoteSelections}
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
				<strong>{statusLabel(status)}</strong>
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
