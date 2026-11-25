/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import { useGetter } from "@atom.io/spa"
import type { TimelineToken } from "atom.io"
import { isReservedIntrospectionKey, timeTravel } from "atom.io/internal"

import { EventView } from "./EventView.tsx"
import { historyIdentity } from "./history-event.ts"
import { type Tools, useExpanded } from "./store.ts"
import css from "./TimelineIndex.module.css"

export function TimelineIndex(props: { tools: Tools }): SpaElement {
	const getTimelineIndex = useGetter(props.tools.timelineIndex)
	const groups = () => {
		const result = new Map<string, TimelineToken<any>[]>()
		for (const token of getTimelineIndex()) {
			if (isReservedIntrospectionKey(token.key) || token.key.startsWith(`👁‍🗨`))
				continue
			const key = token.family?.key ?? ``
			const members = result.get(key) ?? []
			members.push(token)
			result.set(key, members)
		}
		return [...result]
	}
	return (
		<timeline-index class={css.class}>
			<article data-index data-testid="timeline-index">
				{groups().length === 0 ? (
					<p>(no timelines)</p>
				) : (
					groups().map(([family, members]) => (
						<section
							key={family}
							data-testid={family ? `timeline-family-${family}` : undefined}
						>
							{family ? <h2>{family}</h2> : null}
							{members.map((token) => (
								<TimelineLog key={token.key} tools={props.tools} token={token} />
							))}
						</section>
					))
				)}
			</article>
		</timeline-index>
	)
}
function TimelineLog(props: {
	tools: Tools
	token: TimelineToken<any>
}): SpaElement {
	const canOperate = props.tools.worker?.canControl() !== false
	const travel = (action: `undo` | `redo`) => {
		props.tools.attempt(() => {
			if (props.tools.worker)
				props.tools.worker.timeline(props.token.key, action)
			else timeTravel(props.tools.store, action, props.token)
		})
	}
	const getTimeline = useGetter(props.tools.timelineLog(props.token.key))
	const [getOpen, toggle] = useExpanded(props.tools, [props.token.key])
	return (
		<timeline-log data-testid={`timeline-${props.token.key}`}>
			<node-heading>
				<button
					type="button"
					aria-expanded={getOpen()}
					data-testid={`open-close-timeline-${props.token.key}`}
					onClick={toggle}
				>
					{getOpen() ? `▾` : `▸`}
				</button>
				<h2>{props.token.family?.subKey ?? props.token.key}</h2>
				<small>
					({getTimeline().at}/{getTimeline().history.length})
				</small>
				<button
					type="button"
					disabled={!canOperate || getTimeline().at === 0}
					onClick={() => {
						travel(`undo`)
					}}
				>
					undo
				</button>
				<button
					type="button"
					disabled={
						!canOperate || getTimeline().at === getTimeline().history.length
					}
					onClick={() => {
						travel(`redo`)
					}}
				>
					redo
				</button>
			</node-heading>
			{getOpen() ? (
				<section>
					{getTimeline().history.map((event, index) => (
						<section key={index}>
							{index === getTimeline().at ? (
								<p data-cursor>you are here</p>
							) : null}
							<EventView
								key={historyIdentity(event)}
								tools={props.tools}
								event={event}
								index={index}
							/>
						</section>
					))}
					{getTimeline().at === getTimeline().history.length ? (
						<p data-cursor>you are here</p>
					) : null}
				</section>
			) : null}
		</timeline-log>
	)
}
