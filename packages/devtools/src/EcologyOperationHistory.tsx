/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { type EcologyOperation, ecologyTimelinePosition } from "./ecology.ts"
import css from "./EcologyOperationHistory.module.css"
import { EditorIcon } from "./EditorIcon.tsx"
import { type EditorTools, useExpanded } from "./store.ts"
import { TimelineHistory } from "./TimelineHistory.tsx"
import { TimelineTravel } from "./TimelineTravel.tsx"
import { TransactionOutcomes } from "./TransactionOutcomes.tsx"

export function EcologyOperationHistory(props: {
	tools: EditorTools
	operation: Exclude<EcologyOperation, { type: `timeline_family` }>
	label: SpaElement
}): SpaElement {
	const { key, type } = props.operation
	const [expanded, toggle] = useExpanded(props.tools, [
		`ecology-history`,
		type,
		key,
	])
	const transactions =
		type === `transaction` ? props.tools.history.useTransaction(key) : undefined
	const timeline =
		type === `timeline` ? props.tools.history.useTimeline(key) : undefined
	const summary = () => {
		const operation = props.operation
		if (operation.type === `timeline`) return ecologyTimelinePosition(operation)
		const count = transactions!().length
		return `${count} ${count === 1 ? `outcome` : `outcomes`}`
	}
	return (
		<ecology-operation-history class={css.class}>
			<node-heading>
				<button
					type="button"
					aria-label={`${expanded() ? `Collapse` : `Expand`} ${type} ${key}`}
					aria-expanded={expanded()}
					onClick={toggle}
				>
					<EditorIcon name={expanded() ? `collapse` : `expand`} />
				</button>
				{props.label}
				<small>{summary()}</small>
			</node-heading>
			{expanded() &&
				(transactions ? (
					<TransactionOutcomes tools={props.tools} history={transactions()} />
				) : (
					timeline?.() && (
						<>
							<node-heading>
								<TimelineTravel
									tools={props.tools}
									timelineKey={key}
									timeline={timeline()}
								/>
							</node-heading>
							<TimelineHistory tools={props.tools} timeline={timeline()!} />
						</>
					)
				))}
		</ecology-operation-history>
	)
}
