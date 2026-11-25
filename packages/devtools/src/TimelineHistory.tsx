/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { type EcologyEventInteraction, EventView } from "./EventView.tsx"
import { historyIdentity } from "./history-event.ts"
import type { EditorTools, TimelineView } from "./store.ts"
import css from "./TimelineHistory.module.css"

export function TimelineHistory(props: {
	tools: EditorTools
	timeline: TimelineView
	ecology?: EcologyEventInteraction | undefined
}): SpaElement {
	return (
		<timeline-history class={css.class}>
			{props.timeline.history.map((event, index) => (
				<section key={historyIdentity(event)}>
					{index === props.timeline.at && <p data-cursor>you are here</p>}
					<EventView
						tools={props.tools}
						event={event}
						index={index}
						ecology={props.ecology}
					/>
				</section>
			))}
			{props.timeline.at === props.timeline.history.length && (
				<p data-cursor>you are here</p>
			)}
		</timeline-history>
	)
}
