/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { EditorIcon } from "./EditorIcon.tsx"
import { describeOutcomeValue } from "./history-value.ts"
import type { HistoryValuePair } from "./history-value-pair.ts"
import css from "./OutcomeValuePair.module.css"
import { type EditorTools, useExpanded } from "./store.ts"

export function OutcomeValuePair(props: {
	tools: EditorTools
	eventId: string
	name: string
	pair: HistoryValuePair
}): SpaElement {
	const [open, toggle] = useExpanded(props.tools, [
		`value-comparison`,
		props.eventId,
	])
	const snapshot = (side: `before` | `after`) => {
		const { value, preview, description } = props.pair[side]
		return (
			<value-snapshot data-value-side={side}>
				<p>
					<span>{side === `before` ? `Before` : `After`}</span>
					{description && <small>{description}</small>}
				</p>
				<code>
					{open() ? describeOutcomeValue(value, true, true).text : preview}
				</code>
			</value-snapshot>
		)
	}
	return (
		<outcome-value-pair class={css.class}>
			<strong title={props.name}>{props.name}</strong>
			<value-snapshots
				data-value-columns
				data-full-comparison={open() || undefined}
			>
				{snapshot(`before`)}
				{snapshot(`after`)}
			</value-snapshots>
			{props.pair.disclose && (
				<button type="button" aria-expanded={open()} onClick={toggle}>
					<EditorIcon name={open() ? `collapse` : `expand`} />
					{open() ? `Show preview` : `Show full comparison`}
				</button>
			)}
		</outcome-value-pair>
	)
}
