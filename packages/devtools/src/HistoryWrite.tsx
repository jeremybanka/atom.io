/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { EditorIcon } from "./EditorIcon.tsx"
import type { RecordedEvent } from "./history-event.ts"
import { historyCollectionChanges } from "./history-value.ts"
import { historyValuePair } from "./history-value-pair.ts"
import { OutcomeCollectionChange } from "./OutcomeCollectionChange.tsx"
import { OutcomeValue } from "./OutcomeValue.tsx"
import { OutcomeValuePair } from "./OutcomeValuePair.tsx"
import type { EditorTools } from "./store.ts"

export function HistoryWrite(props: {
	tools: EditorTools
	eventId: string
	event: Extract<RecordedEvent, { update: unknown }>
	showName: boolean
}): SpaElement {
	const { token, update } = props.event
	const { oldValue, newValue } = update
	const collection = historyCollectionChanges(oldValue, newValue)
	const pair = collection ? undefined : historyValuePair(oldValue, newValue)
	return (
		<history-write>
			{collection ? (
				<OutcomeCollectionChange
					tools={props.tools}
					eventId={props.eventId}
					name={token.key}
					change={collection}
					showName={props.showName}
				/>
			) : pair ? (
				<OutcomeValuePair
					tools={props.tools}
					eventId={props.eventId}
					name={token.key}
					pair={pair}
					showName={props.showName}
				/>
			) : (
				<p
					data-change
					data-compact-write
					data-unnamed={!props.showName || undefined}
				>
					{props.showName && <strong title={token.key}>{token.key}</strong>}
					<del data-kind={typeof oldValue}>
						<OutcomeValue
							tools={props.tools}
							eventId={props.eventId}
							label="previous value"
							value={oldValue}
						/>
					</del>
					<span role="img" aria-label="changed to">
						<EditorIcon name="arrow" />
					</span>
					<ins data-kind={typeof newValue}>
						<OutcomeValue
							tools={props.tools}
							eventId={props.eventId}
							label="new value"
							value={newValue}
						/>
					</ins>
				</p>
			)}
		</history-write>
	)
}
