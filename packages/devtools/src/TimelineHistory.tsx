/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { type EcologyEventInteraction, EventView } from "./EventView.tsx"
import { historyIdentity } from "./history-event.ts"
import type { EditorTools, TimelineView } from "./store.ts"
import css from "./TimelineHistory.module.css"

export function TimelineHistory(props: {
	tools: EditorTools
	timelineKey: string
	timeline: TimelineView
	ecology?: EcologyEventInteraction | undefined
}): SpaElement {
	const entries = () => {
		const { at, history } = props.timeline
		// Undo rewinds to the start of the current checkpoint, as in timeTravel.
		let undoStart = at - 1
		while (undoStart > 0 && history[undoStart].checkpoint !== true) undoStart--
		return history.map((event, index) => ({
			event,
			index,
			applied: index < at,
			undo: index >= undoStart && index < at,
			redoNext: index === at,
		}))
	}
	const cursor = () => <p data-cursor>Current position</p>
	return (
		<timeline-history class={css.class}>
			{props.timeline.history.length === 0 ? (
				<p data-empty-history>No recorded events</p>
			) : (
				<>
					{entries().map(({ event, index, applied, undo, redoNext }) => (
						<section
							key={historyIdentity(event)}
							data-undo-range={undo || undefined}
						>
							{redoNext && cursor()}
							<EventView
								tools={props.tools}
								event={event}
								index={index}
								ecology={props.ecology}
								timeline={{ key: props.timelineKey, applied, redoNext }}
							/>
						</section>
					))}
					{props.timeline.at === props.timeline.history.length && cursor()}
				</>
			)}
		</timeline-history>
	)
}
