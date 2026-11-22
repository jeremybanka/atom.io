import type { Children, SpaElement } from "@atom.io/spa"
import { useId } from "@atom.io/spa"

import css from "./CodeBlock.module.css"
import { highlightCode } from "./highlight-code.ts"

type CodeBlockProps = {
	filepath?: string
	label?: string
	code?: string
	soft?: boolean
	children?: Children
	exhibitSource?: string
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

function flattenChildrenToString(children: Children): string {
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
	exhibitSource,
}: CodeBlockProps): SpaElement {
	const displayLabel = label ?? filepath ?? `code`
	const code = codeProp ?? flattenChildrenToString(children)
	const { tokens } = highlightCode(code, filepath)
	const id = `exhibit-${useId()}`

	return (
		<code-block
			id={getCodeBlockId(displayLabel)}
			class={css.class}
			data-exhibit-source={exhibitSource}
		>
			<back-fill class={soft ? `soft` : `hard`} />
			<file-name>
				<span>{displayLabel}</span>
				{exhibitSource && (
					<nav role="tablist" aria-label="Exhibit views">
						<button
							type="button"
							role="tab"
							id={`${id}-code-tab`}
							aria-controls={`${id}-code`}
							aria-label="Code"
							aria-selected="true"
							tabIndex={0}
						>
							<svg viewBox="0 0 16 16" aria-hidden="true">
								<path d="m5 4-4 4 4 4m6-8 4 4-4 4m-2-9L7 13" />
							</svg>
							<span>Code</span>
						</button>
						<button
							type="button"
							role="tab"
							id={`${id}-ecology-tab`}
							aria-controls={`${id}-ecology`}
							aria-label="Ecology"
							aria-selected="false"
							tabIndex={-1}
						>
							<svg viewBox="0 0 16 16" aria-hidden="true">
								<path d="M7 5 4 10m5-5 3 5M5 12h6" />
								<circle cx="8" cy="3.5" r="2" />
								<circle cx="3" cy="12" r="2" />
								<circle cx="13" cy="12" r="2" />
							</svg>
							<span>Ecology</span>
						</button>
					</nav>
				)}
				<button type="button" aria-label="Copy code">
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
			<pre
				id={exhibitSource ? `${id}-code` : undefined}
				role={exhibitSource ? `tabpanel` : undefined}
				aria-labelledby={exhibitSource ? `${id}-code-tab` : undefined}
				tabIndex={exhibitSource ? 0 : undefined}
			>
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
			{exhibitSource && (
				<section
					id={`${id}-ecology`}
					role="tabpanel"
					aria-labelledby={`${id}-ecology-tab`}
					data-ecology-panel
					hidden
				/>
			)}
		</code-block>
	)
}
