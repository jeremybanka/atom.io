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
	exhibit?: { source: string; ecology: boolean; preview: boolean }
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
	exhibit,
}: CodeBlockProps): SpaElement {
	const displayLabel = label ?? filepath ?? `code`
	const code = codeProp ?? flattenChildrenToString(children)
	const { tokens } = highlightCode(code, filepath)
	const id = `exhibit-${useId()}`
	const tabs = [
		{
			view: `code`,
			label: `Code`,
			enabled: true,
			icon: <path d="m5 4-4 4 4 4m6-8 4 4-4 4m-2-9L7 13" />,
		},
		{
			view: `ecology`,
			label: `Ecology`,
			enabled: exhibit?.ecology,
			icon: (
				<>
					<path d="M7 5 4 10m5-5 3 5M5 12h6" />
					<circle cx="8" cy="3.5" r="2" />
					<circle cx="3" cy="12" r="2" />
					<circle cx="13" cy="12" r="2" />
				</>
			),
		},
		{
			view: `preview`,
			label: `Preview`,
			enabled: exhibit?.preview,
			icon: (
				<>
					<rect x="1.5" y="2.5" width="13" height="11" rx="1" />
					<path d="M2 5.5h12m-8 2 4 2-4 2z" />
				</>
			),
		},
	].filter((tab) => tab.enabled)

	return (
		<code-block
			id={getCodeBlockId(displayLabel)}
			class={css.class}
			data-exhibit-source={exhibit?.source}
			data-exhibit-view={exhibit ? `code` : undefined}
		>
			<back-fill class={soft ? `soft` : `hard`} />
			<file-name>
				<span>{displayLabel}</span>
				{exhibit && (
					<nav role="tablist" aria-label="Exhibit views">
						{tabs.map(({ view, label: tabLabel, icon }) => (
							<button
								key={view}
								type="button"
								role="tab"
								id={`${id}-${view}-tab`}
								aria-controls={`${id}-${view === `code` ? `code` : `live`}`}
								aria-label={tabLabel}
								aria-selected={view === `code` ? `true` : `false`}
								data-exhibit-tab={view}
								data-exhibit-visible={view === `code` ? `` : undefined}
								tabIndex={view === `code` ? 0 : -1}
							>
								<svg viewBox="0 0 16 16" aria-hidden="true">
									{icon}
								</svg>
								<span>{tabLabel}</span>
							</button>
						))}
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
				id={exhibit ? `${id}-code` : undefined}
				role={exhibit ? `tabpanel` : undefined}
				aria-labelledby={exhibit ? `${id}-code-tab` : undefined}
				tabIndex={exhibit ? 0 : undefined}
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
			{exhibit && (
				<section id={`${id}-live`} role="tabpanel" data-exhibit-panel hidden />
			)}
		</code-block>
	)
}
