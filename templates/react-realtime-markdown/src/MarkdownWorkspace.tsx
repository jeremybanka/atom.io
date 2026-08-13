import type { MosaicTextSelection } from "atom.io/realtime"
import { useMosaic } from "atom.io/realtime-react"
import {
	Fragment,
	createElement,
	type CSSProperties,
	type ReactElement,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"

import {
	lineAndColumnAt,
	markdownHistory,
	markdownModel,
	markdownResource,
	type MarkdownPresence,
} from "./collaboration/mosaic.ts"
import { SIMULATED_IDENTITIES } from "./identities.ts"
import type { Identity } from "./identities.ts"
import { switchBrowserIdentity } from "./session.ts"
import css from "./MarkdownWorkspace.module.css"

type MarkdownWorkspaceProps = {
	clientId: string
	identity: Identity
}

type CaretStyle = CSSProperties &
	Record<`--caret-column` | `--caret-line` | `--person-color`, number | string>

function safeHref(candidate: string): string | undefined {
	return /^(https?:\/\/|mailto:|#)/.test(candidate) ? candidate : undefined
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
	const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
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
			const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
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

function startsBlock(line: string): boolean {
	return /^(#{1,6} |```|> |[-*] |\d+\. )/.test(line)
}

function renderMarkdown(markdown: string): ReactNode[] {
	const lines = markdown.split(`\n`)
	const blocks: ReactNode[] = []
	let index = 0
	while (index < lines.length) {
		const line = lines[index]
		if (line.trim() === ``) {
			index++
			continue
		}
		if (line.startsWith(`\`\`\``)) {
			const language = line.slice(3).trim()
			const code: string[] = []
			index++
			while (index < lines.length && !lines[index].startsWith(`\`\`\``)) {
				code.push(lines[index])
				index++
			}
			index++
			blocks.push(
				<pre key={`code:${index}`} data-language={language || undefined}>
					<code>{code.join(`\n`)}</code>
				</pre>,
			)
			continue
		}
		const heading = /^(#{1,6}) (.*)$/.exec(line)
		if (heading) {
			blocks.push(
				createElement(
					`h${heading[1].length}`,
					{ key: `heading:${index}` },
					renderInline(heading[2], `heading:${index}`),
				),
			)
			index++
			continue
		}
		if (/^[-*] /.test(line)) {
			const items: ReactNode[] = []
			while (index < lines.length && /^[-*] /.test(lines[index])) {
				items.push(
					<li key={`item:${index}`}>
						{renderInline(lines[index].slice(2), `item:${index}`)}
					</li>,
				)
				index++
			}
			blocks.push(<ul key={`list:${index}`}>{items}</ul>)
			continue
		}
		if (/^\d+\. /.test(line)) {
			const items: ReactNode[] = []
			while (index < lines.length && /^\d+\. /.test(lines[index])) {
				items.push(
					<li key={`item:${index}`}>
						{renderInline(lines[index].replace(/^\d+\. /, ``), `item:${index}`)}
					</li>,
				)
				index++
			}
			blocks.push(<ol key={`list:${index}`}>{items}</ol>)
			continue
		}
		if (line.startsWith(`> `)) {
			blocks.push(
				<blockquote key={`quote:${index}`}>
					{renderInline(line.slice(2), `quote:${index}`)}
				</blockquote>,
			)
			index++
			continue
		}

		const paragraph = [line]
		index++
		while (
			index < lines.length &&
			lines[index].trim() !== `` &&
			!startsBlock(lines[index])
		) {
			paragraph.push(lines[index])
			index++
		}
		blocks.push(
			<p key={`paragraph:${index}`}>
				{renderInline(paragraph.join(` `), `paragraph:${index}`)}
			</p>,
		)
	}
	return blocks
}

function getStatusLabel(status: string, pending: number): string {
	if (status === `offline`) return `Offline · changes stay queued`
	if (status === `recovering` || status === `syncing`) {
		return `Catching up…`
	}
	if (status === `rejected`) return `Collaboration needs attention`
	return pending === 0
		? `All changes saved`
		: `Saving ${pending} change${pending === 1 ? `` : `s`}…`
}

export function MarkdownWorkspace({
	clientId,
	identity,
}: MarkdownWorkspaceProps): ReactElement {
	const mosaic = useMosaic<
		typeof markdownModel,
		MarkdownPresence,
		ReturnType<typeof markdownModel.timeline>
	>({
		actor: identity.id,
		history: markdownHistory,
		resource: markdownResource,
		session: clientId,
	})
	const document = mosaic.state
	const markdown = markdownModel.text(document)
	const timeline = mosaic.history
	const presence = mosaic.presence.map(({ actor, presence: peer, session }) => ({
		...peer,
		clientId: session,
		id: actor,
	}))
	const editorRef = useRef<HTMLTextAreaElement | null>(null)
	const selectionRef = useRef<MosaicTextSelection | null>(null)
	const [scroll, setScroll] = useState({ left: 0, top: 0 })
	const preview = useMemo(() => renderMarkdown(markdown), [markdown])
	const collaborators = presence.filter(({ clientId: id }) => id !== clientId)
	const pending = mosaic.pendingOperationIds.length

	const publishSelection = (selection: MosaicTextSelection | null): void => {
		mosaic.publishPresence({
			color: identity.color,
			lastActiveAt: Date.now(),
			name: identity.name,
			selection,
		})
	}

	useEffect(() => {
		if (mosaic.status === `live`) publishSelection(selectionRef.current)
	}, [mosaic.status])

	useLayoutEffect(() => {
		const editor = editorRef.current
		const selection = selectionRef.current
		if (!editor || !selection || globalThis.document.activeElement !== editor) {
			return
		}
		editor.setSelectionRange(
			markdownModel.resolvePosition(document, selection.anchor),
			markdownModel.resolvePosition(document, selection.head),
		)
	}, [document])

	const rememberSelection = (editor: HTMLTextAreaElement): void => {
		selectionRef.current = markdownModel.selectionFromOffsets(
			document,
			editor.selectionStart,
			editor.selectionEnd,
		)
		publishSelection(selectionRef.current)
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
					<span>{getStatusLabel(mosaic.status, pending)}</span>
				</document-title>
				<toolbar-actions>
					<button
						type="button"
						disabled={timeline.undo.length === 0}
						onClick={() => mosaic.undo()}
						title="Undo my last change"
					>
						↶ <span>Undo mine</span>
					</button>
					<button
						type="button"
						disabled={timeline.redo.length === 0}
						onClick={() => mosaic.redo()}
						title="Redo my last change"
					>
						↷ <span>Redo</span>
					</button>
					<label>
						<avatar-dot
							style={{ "--person-color": identity.color } as CSSProperties}
						>
							{identity.name[0]}
						</avatar-dot>
						<select
							aria-label="Simulated identity"
							value={identity.id}
							onChange={(event) => {
								switchBrowserIdentity(event.target.value)
							}}
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
						<span>{markdown.length.toLocaleString()} characters</span>
					</pane-heading>
					<editor-surface>
						<textarea
							id="markdown-source"
							ref={editorRef}
							aria-label="Shared markdown source"
							value={markdown}
							disabled={
								mosaic.status === `recovering` || mosaic.status === `syncing`
							}
							onChange={(event) => {
								const { selectionStart, selectionEnd, value } =
									event.currentTarget
								mosaic.change({ text: value, type: `replace-text` })
								selectionRef.current = markdownModel.selectionFromOffsets(
									mosaic.client.read().state,
									selectionStart,
									selectionEnd,
								)
								publishSelection(selectionRef.current)
							}}
							onKeyDown={(event) => {
								if (!(event.metaKey || event.ctrlKey) || event.key !== `z`)
									return
								event.preventDefault()
								event.shiftKey ? mosaic.redo() : mosaic.undo()
							}}
							onScroll={(event) => {
								setScroll({
									left: event.currentTarget.scrollLeft,
									top: event.currentTarget.scrollTop,
								})
							}}
							onSelect={(event) => {
								rememberSelection(event.currentTarget)
							}}
							spellCheck
						/>
						<caret-layer aria-hidden="true">
							{collaborators.map((person) => {
								const relative = person.selection?.head
								if (!relative) return null
								const offset = markdownModel.resolvePosition(document, relative)
								const { line, column } = lineAndColumnAt(markdown, offset)
								const style: CaretStyle = {
									"--caret-column": column,
									"--caret-line": line,
									"--person-color": person.color,
									translate: `${-scroll.left}px ${-scroll.top}px`,
								}
								return (
									<remote-caret key={person.clientId} style={style}>
										<span>{person.name.split(` `)[0]}</span>
									</remote-caret>
								)
							})}
						</caret-layer>
					</editor-surface>
				</editor-pane>
				<preview-pane>
					<pane-heading>
						<strong>Preview</strong>
						<span>React-rendered · safe HTML</span>
					</pane-heading>
					<article>{preview}</article>
				</preview-pane>
				<presence-rail>
					<strong>In this document</strong>
					<ul>
						{presence.map((person) => {
							const offset = person.selection
								? markdownModel.resolvePosition(document, person.selection.head)
								: null
							const line =
								offset === null
									? null
									: lineAndColumnAt(markdown, offset).line + 1
							return (
								<li
									key={person.clientId}
									data-self={person.clientId === clientId}
								>
									<avatar-dot
										style={{ "--person-color": person.color } as CSSProperties}
									>
										{person.name[0]}
									</avatar-dot>
									<person-label>
										<strong>{person.name}</strong>
										<span>
											{person.clientId === clientId
												? `You · editing now`
												: line
													? `Editing near line ${line}`
													: `Viewing`}
										</span>
									</person-label>
								</li>
							)
						})}
					</ul>
					<aside>
						<strong>Undo without collisions</strong>
						<p>
							Your history removes only characters and deletion marks you
							authored. Everyone else’s work stays put.
						</p>
					</aside>
				</presence-rail>
			</main>
			<footer>
				<span data-status={mosaic.status} />
				<strong>
					{mosaic.status === `live`
						? `Realtime connected`
						: getStatusLabel(mosaic.status, pending)}
				</strong>
				<small>Revision {mosaic.revision}</small>
				{mosaic.problem ? <output>{mosaic.problem.reason}</output> : null}
			</footer>
		</markdown-workspace>
	)
}
