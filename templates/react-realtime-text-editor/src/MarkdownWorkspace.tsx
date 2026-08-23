import { useMosaicTextEditor, useMosaicTextRange } from "atom.io/realtime-react"
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

export function MarkdownWorkspace({
	client,
}: MarkdownWorkspaceProps): ReactElement {
	const [status, setStatus] = useState(() => client.status())
	const [presence, setPresence] = useState(() => activePresence(client))
	const [totalLength, setTotalLength] = useState(0)
	const [scroll, setScroll] = useState({ height: 560, scrollTop: 0 })
	const [parse, setParse] = useState<readonly MarkdownSemanticBlock[]>([])
	const [parseMetrics, setParseMetrics] =
		useState<MarkdownParseInstrumentation>(EMPTY_PARSE_METRICS)
	const [readProblem, setReadProblem] = useState<string | null>(null)
	const [problem, setProblem] = useState<string | null>(null)
	const parser = useRef(new IncrementalMarkdownParser())
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
	const refreshLength = useCallback(async (): Promise<number | null> => {
		try {
			const length = await client.projection.readLength()
			setTotalLength(length)
			setReadProblem(null)
			return length
		} catch (error) {
			setReadProblem(error instanceof Error ? error.message : String(error))
			return null
		}
	}, [client])

	const peers = useMemo(
		() =>
			presence
				.filter((person) => person.session !== client.sessionId)
				.map((person) => ({
					id: person.session,
					selection: person.selection,
					value: person,
				})),
		[client.sessionId, presence],
	)
	const publishSelection = useCallback(
		(selection: NonNullable<MarkdownPresence[`selection`]>) =>
			client.publishPresence({
				color: client.identity.color,
				name: client.identity.name,
				selection,
				viewport: null,
			}),
		[client],
	)
	const replace = useCallback(
		(input: Parameters<MarkdownCollaborationClient[`replace`]>[0]) =>
			client.replace(input),
		[client],
	)
	const reportEditorError = useCallback((error: unknown): void => {
		setProblem(error instanceof Error ? error.message : String(error))
	}, [])
	const editor = useMosaicTextEditor({
		client: client.projection,
		connected: status.connection === `live`,
		documentLength: totalLength,
		onDocumentLength: setTotalLength,
		onError: reportEditorError,
		peers,
		projection: incomingProjection,
		publishSelection,
		replace,
	})
	const projection = editor.projection

	useEffect(() => {
		const stopStatus = client.subscribe((next) => {
			setStatus(next)
			if (next.connection === `live`) {
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
			parser.current.cancel()
		}
	}, [client, refreshLength])

	useEffect(() => {
		if (editor.hasLocalDraft || deferredScroll.current === null) return
		setScroll(deferredScroll.current)
		deferredScroll.current = null
	}, [editor.hasLocalDraft])

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
		if (
			projection === null ||
			editor.hasLocalDraft ||
			editor.hasLocalSelection
		) {
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
		editor.hasLocalDraft,
		editor.hasLocalSelection,
		projection,
		window.range.end,
		window.range.start,
	])

	const collaboratorSelections: readonly RenderedCollaboratorSelection[] =
		editor.remoteSelections.map(({ end, id, start, value: person }) => ({
			color: person.color,
			end,
			name: person.name,
			session: id,
			start,
		}))

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
					<span>{statusLabel(status, editor.hasLocalDraft)}</span>
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
							if (editor.hasLocalDraft) {
								deferredScroll.current = nextScroll
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
								onDirty={editor.onDirty}
								onError={(error) => setProblem(error.message)}
								onRedo={() => void client.redo()}
								onSelectionChange={editor.onSelectionChange}
								onUndo={() => void client.undo()}
								onValueChange={editor.onValueChange}
								selections={collaboratorSelections}
								selection={editor.selection}
								value={editor.text}
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
				<strong>{statusLabel(status, editor.hasLocalDraft)}</strong>
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
