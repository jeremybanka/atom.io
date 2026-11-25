/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { type EcologyOperation, ecologyTimelinePosition } from "./ecology.ts"
import css from "./EcologyOperationHistory.module.css"
import { EditorIcon } from "./EditorIcon.tsx"
import type { EcologyEventInteraction } from "./EventView.tsx"
import type { EditorTools } from "./store.ts"
import { TimelineHistory } from "./TimelineHistory.tsx"
import { TimelineTravel } from "./TimelineTravel.tsx"
import { TransactionOutcomes } from "./TransactionOutcomes.tsx"

export function EcologyOperationHistory(props: {
	tools: EditorTools
	operation: Exclude<EcologyOperation, { type: `timeline_family` }>
	id: string
	expanded: boolean
	label: SpaElement
	events: EcologyEventInteraction
}): SpaElement {
	const { key, type } = props.operation
	const transactions =
		type === `transaction` ? props.tools.history.useTransaction(key) : undefined
	const timeline =
		type === `timeline` ? props.tools.history.useTimeline(key) : undefined
	const summary = () => {
		const operation = props.operation
		if (operation.type === `timeline`)
			return ecologyTimelinePosition(operation, timeline?.())
		const count = transactions!().length
		return `${count} ${count === 1 ? `outcome` : `outcomes`}`
	}
	return (
		<ecology-operation-history class={css.class}>
			<node-heading>
				<button
					type="button"
					data-action="expand"
					data-family-id={props.id}
					aria-label={`${props.expanded ? `Collapse` : `Expand`} ${type} ${key}`}
					aria-expanded={props.expanded}
				>
					<EditorIcon name={props.expanded ? `collapse` : `expand`} />
				</button>
				{props.label}
				<small>{summary()}</small>
				{props.expanded && timeline?.() && (
					<TimelineTravel
						tools={props.tools}
						timelineKey={key}
						timeline={timeline()}
						icons
					/>
				)}
			</node-heading>
			{props.expanded &&
				(transactions ? (
					<TransactionOutcomes
						tools={props.tools}
						history={transactions()}
						ecology={props.events}
					/>
				) : (
					timeline?.() && (
						<TimelineHistory
							tools={props.tools}
							timeline={timeline()!}
							ecology={props.events}
						/>
					)
				))}
		</ecology-operation-history>
	)
}
