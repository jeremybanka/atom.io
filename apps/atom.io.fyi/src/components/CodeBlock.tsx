import type { Child, VNode } from "hydrogen"

import css from "./CodeBlock.module.css"
import { highlightCode } from "./highlight-code"

type CodeBlockProps = {
	filepath?: string
	label?: string
	code?: string
	soft?: boolean
	children?: Child
}

function getCodeBlockId(labelOrHref: string): string {
	const label =
		labelOrHref
			.replace(/^["']|["']$/g, ``)
			.split(`/`)
			.pop() ?? ``
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, `-`)
		.replace(/^-+|-+$/g, ``)
}

function flattenChildrenToString(children: Child): string {
	if (typeof children === `function`) return flattenChildrenToString(children())
	if (Array.isArray(children))
		return children.map(flattenChildrenToString).join(``)
	return typeof children === `string` || typeof children === `number`
		? String(children)
		: ``
}

export function CodeBlock({
	filepath,
	label,
	code: codeProp,
	soft = false,
	children,
}: CodeBlockProps): VNode {
	const displayLabel = label ?? filepath ?? `code`
	const code = codeProp ?? flattenChildrenToString(children)
	const { tokens } = highlightCode(code, filepath)

	return (
		<code-block id={getCodeBlockId(displayLabel)} class={css.class}>
			<back-fill class={soft ? `soft` : `hard`} />
			<file-name>
				<span>{displayLabel}</span>
				<button type="button">
					<svg viewBox="0 0 16 16">
						<title>copy</title>
						<path
							d="M15,5v10H5V5h10M16,4H4v12h12V4h0Z"
							fill="var(--icon-color)"
						/>
						<polygon
							points="3 11 1 11 1 1 11 1 11 3 12 3 12 0 0 0 0 12 3 12 3 11"
							fill="var(--icon-color)"
						/>
					</svg>
				</button>
			</file-name>
			<pre>
				<code>
					{tokens.map((line, lineIndex) => [
						lineIndex > 0 ? `\n` : ``,
						line.map((token) => (
							<span
								key={token.offset}
								style={`color:${token.color}`}
								data-code-string={token.type === 2 ? `` : undefined}
							>
								{token.content}
							</span>
						)),
					])}
				</code>
			</pre>
		</code-block>
	)
}
