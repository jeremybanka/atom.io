/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import css from "./EventView.module.css"
import {
	historyEventPreview,
	historyIdentity,
	historyParams,
	historyValue,
	type RecordedEvent,
} from "./history-event.ts"
import { type EditorTools, useExpanded } from "./store.ts"

export function EventView(props: {
	tools: EditorTools
	event: RecordedEvent
	index: number
	depth?: number
}): SpaElement {
	const event = props.event
	const token = `token` in event ? event.token : undefined
	const depth = props.depth ?? 0
	const descendants = `subEvents` in event ? event.subEvents : []
	const [getOpen, toggle] = useExpanded(
		props.tools,
		[`event`, historyIdentity(event)],
		true,
	)
	const nested = () =>
		depth < 31
			? descendants.map((child, index) => (
					<EventView
						key={historyIdentity(child)}
						tools={props.tools}
						event={child}
						index={index}
						depth={depth + 1}
					/>
				))
			: `Nested events omitted`
	return (
		<event-view
			class={css.class}
			data-testid={`${event.type === `transaction_outcome` ? `transaction` : `timeline`}-update-${token?.key}-${props.index}`}
		>
			<event-heading>
				<button type="button" aria-expanded={getOpen()} onClick={toggle}>
					{getOpen() ? `▾` : `▸`}
				</button>
				<strong>{token?.key}</strong>
				<small>{event.type}</small>
			</event-heading>
			{getOpen() ? (
				event.type === `transaction_outcome` ? (
					<>
						<p>
							params: <code>{historyParams(event.params)}</code>
						</p>
						<p>
							output: <code>{historyValue(event.output) ?? `[opaque]`}</code>
						</p>
						<event-impact>{nested()}</event-impact>
					</>
				) : `update` in event ? (
					<p>
						<del data-kind={typeof event.update.oldValue}>
							{historyValue(event.update.oldValue) ?? `[opaque]`}
						</del>
						{` `}→{` `}
						<ins data-kind={typeof event.update.newValue}>
							{historyValue(event.update.newValue) ?? `[opaque]`}
						</ins>
					</p>
				) : descendants.length ? (
					<event-impact>{nested()}</event-impact>
				) : (
					<code>{historyEventPreview(event)}</code>
				)
			) : null}
		</event-view>
	)
}
