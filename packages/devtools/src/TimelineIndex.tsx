/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import { useGetter } from "@atom.io/spa"
import type { TimelineToken } from "atom.io"
import { isReservedIntrospectionKey } from "atom.io/internal"

import { type Tools, useExpanded } from "./store.ts"
import { TimelineHistory } from "./TimelineHistory.tsx"
import css from "./TimelineIndex.module.css"
import { TimelineTravel } from "./TimelineTravel.tsx"

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
	const getTimeline = props.tools.history.useTimeline(props.token.key)
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
					({getTimeline()?.at ?? 0}/{getTimeline()?.history.length ?? 0})
				</small>
				<TimelineTravel
					tools={props.tools}
					timelineKey={props.token.key}
					timeline={getTimeline()}
				/>
			</node-heading>
			{getOpen() && getTimeline() ? (
				<TimelineHistory tools={props.tools} timeline={getTimeline()!} />
			) : null}
		</timeline-log>
	)
}
