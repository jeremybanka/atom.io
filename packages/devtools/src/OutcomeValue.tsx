/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { describeOutcomeValue } from "./history-value.ts"
import css from "./OutcomeValue.module.css"
import { type EditorTools, useExpanded } from "./store.ts"

export function OutcomeValue(
	props: {
		tools: EditorTools
		eventId: string
		label: string
		summary?: string | undefined
	} & ({ value: unknown } | { preview: string; full(): string }),
): SpaElement {
	const [open, toggle] = useExpanded(props.tools, [
		`outcome-value`,
		props.eventId,
		props.label,
	])
	const { text, truncated } =
		`value` in props
			? describeOutcomeValue(props.value)
			: { text: props.preview, truncated: false }
	return (
		<outcome-value class={css.class}>
			{props.summary !== undefined || text.length > 16 || truncated ? (
				<button
					type="button"
					aria-label={`${open() ? `Collapse` : `Show full`} ${props.label}`}
					aria-expanded={open()}
					onClick={toggle}
				>
					<code>
						{open()
							? `value` in props
								? describeOutcomeValue(props.value, true).text
								: props.full()
							: (props.summary ??
								(text.length > 16 ? `${text.slice(0, 15)}…` : text))}
					</code>
				</button>
			) : (
				<code title={text}>{text}</code>
			)}
		</outcome-value>
	)
}
