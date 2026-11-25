/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import css from "./OutcomeValue.module.css"
import { type EditorTools, useExpanded } from "./store.ts"

export function OutcomeValue(props: {
	tools: EditorTools
	eventId: string
	label: string
	preview: string
	full(): string
}): SpaElement {
	const [open, toggle] = useExpanded(props.tools, [
		`outcome-value`,
		props.eventId,
		props.label,
	])
	return (
		<outcome-value class={css.class}>
			{props.preview.length > 16 ? (
				<button
					type="button"
					aria-label={`${open() ? `Collapse` : `Show full`} ${props.label}`}
					aria-expanded={open()}
					onClick={toggle}
				>
					<code>{open() ? props.full() : `${props.preview.slice(0, 15)}…`}</code>
				</button>
			) : (
				<code title={props.preview}>{props.preview}</code>
			)}
		</outcome-value>
	)
}
