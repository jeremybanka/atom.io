/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { EditorIcon } from "./EditorIcon.tsx"
import css from "./EventView.module.css"
import {
	historyEventPreview,
	historyGraphId,
	historyIdentity,
	historyParams,
	historyValue,
	type RecordedEvent,
} from "./history-event.ts"
import { type EditorTools, useExpanded } from "./store.ts"

export interface EcologyEventInteraction {
	owner: string
	hovered: string | undefined
	selected: string | undefined
}

export function EventView(props: {
	tools: EditorTools
	event: RecordedEvent
	index: number
	depth?: number
	ecology?: EcologyEventInteraction | undefined
}): SpaElement {
	const event = props.event
	const token = `token` in event ? event.token : undefined
	const depth = props.depth ?? 0
	const identity = historyIdentity(event)
	const owner = props.ecology?.owner
	const graphId = owner ? historyGraphId(owner, identity) : undefined
	const selected = () =>
		graphId ? props.ecology!.selected === graphId : undefined
	const label = () => (
		<>
			<strong>{token?.key}</strong>
			<small>{event.type}</small>
		</>
	)
	const descendants = `subEvents` in event ? event.subEvents : []
	const [getOpen, toggle] = useExpanded(props.tools, [`event`, identity], true)
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
			data-history-event={identity}
			data-history-graph-id={graphId}
			data-hovered={graphId ? props.ecology!.hovered === graphId : undefined}
			data-selected={selected()}
			data-testid={`${event.type === `transaction_outcome` ? `transaction` : `timeline`}-update-${token?.key}-${props.index}`}
		>
			<event-heading>
				<button
					type="button"
					aria-label={getOpen() ? `Collapse event` : `Expand event`}
					aria-expanded={getOpen()}
					onClick={toggle}
				>
					<EditorIcon name={getOpen() ? `collapse` : `expand`} />
				</button>
				{owner ? (
					<button
						type="button"
						data-graph-id={graphId}
						data-history-owner={owner}
						aria-label={`Select ${owner.startsWith(`transaction:`) ? `outcome` : `timeline event`} ${props.index + 1}`}
						aria-pressed={selected()}
					>
						{label()}
					</button>
				) : (
					label()
				)}
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
					<p data-change>
						<del data-kind={typeof event.update.oldValue}>
							{historyValue(event.update.oldValue) ?? `[opaque]`}
						</del>
						<span role="img" aria-label="changed to">
							<EditorIcon name="arrow" />
						</span>
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
