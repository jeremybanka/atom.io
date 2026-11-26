/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import { timeTravel } from "atom.io/internal"

import { EditorIcon } from "./EditorIcon.tsx"
import type { EditorTools, TimelineView } from "./store.ts"
import css from "./TimelineTravel.module.css"

export function TimelineTravel(props: {
	tools: EditorTools
	timelineKey: string
	timeline: TimelineView | undefined
}): SpaElement {
	const enabled = (action: `undo` | `redo`) => {
		const timeline = props.timeline
		return (
			timeline !== undefined &&
			props.tools.worker?.canControl() !== false &&
			(action === `undo`
				? timeline.at > 0
				: timeline.at < timeline.history.length)
		)
	}
	const travel = (action: `undo` | `redo`) => {
		if (!enabled(action)) return
		props.tools.attempt(() => {
			if (props.tools.worker)
				props.tools.worker.timeline(props.timelineKey, action)
			else
				timeTravel(props.tools.store, action, {
					type: `timeline`,
					key: props.timelineKey,
				})
		})
	}
	return (
		<timeline-travel class={css.class}>
			<button
				type="button"
				aria-label="undo"
				data-undo
				title="Undo"
				disabled={!enabled(`undo`)}
				onClick={() => {
					travel(`undo`)
				}}
			>
				<EditorIcon name="undo" />
			</button>
			<button
				type="button"
				aria-label="redo"
				title="Redo"
				disabled={!enabled(`redo`)}
				onClick={() => {
					travel(`redo`)
				}}
			>
				<EditorIcon name="redo" />
			</button>
		</timeline-travel>
	)
}
