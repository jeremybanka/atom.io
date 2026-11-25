/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { EventView } from "./EventView.tsx"
import { historyIdentity } from "./history-event.ts"
import type { EditorTools, TransactionHistory } from "./store.ts"
import css from "./TransactionOutcomes.module.css"

export function TransactionOutcomes(props: {
	tools: EditorTools
	history: TransactionHistory
}): SpaElement {
	return (
		<transaction-outcomes class={css.class}>
			{props.history.length === 0 ? (
				<p>No recorded outcomes</p>
			) : (
				props.history.map((event, index) => (
					<EventView
						key={historyIdentity(event)}
						tools={props.tools}
						event={event}
						index={index}
					/>
				))
			)}
		</transaction-outcomes>
	)
}
