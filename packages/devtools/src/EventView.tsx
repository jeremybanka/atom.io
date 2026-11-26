/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { EditorIcon } from "./EditorIcon.tsx"
import css from "./EventView.module.css"
import {
	compactOutcomePath,
	historyEventPreview,
	historyGraphId,
	historyIdentity,
	historyParams,
	historyValue,
	historyWriteCount,
	type RecordedEvent,
	timelineEventKind,
	timelineEventTitle,
} from "./history-event.ts"
import { describeOutcomeValue, historySnapshotShape } from "./history-value.ts"
import { HistoryWrite } from "./HistoryWrite.tsx"
import { OutcomeValue } from "./OutcomeValue.tsx"
import { type EditorTools, useExpanded } from "./store.ts"
import { TimelineOutcomeLink } from "./TimelineOutcomeLink.tsx"

export interface EcologyEventInteraction {
	owner: string
	hovered: string | undefined
	selected: string | undefined
	viewOutcome?(owner: string, outcome: string): boolean
}

const displayValue = (value: unknown, limit?: number) =>
	historyValue(value, limit) ?? `[opaque]`

export function EventView(props: {
	tools: EditorTools
	event: RecordedEvent
	index: number
	depth?: number
	ecology?: EcologyEventInteraction | undefined
	compact?: boolean | undefined
	timeline?: { key: string; applied: boolean; redoNext: boolean } | undefined
	timelineChild?: boolean | undefined
	initialOpen?: boolean
}): SpaElement {
	const event = props.event
	const token = `token` in event ? event.token : undefined
	const depth = props.depth ?? 0
	const timelineEvent = props.timeline !== undefined
	const timelineDetails = timelineEvent || props.timelineChild === true
	const compact = timelineEvent || props.compact === true
	const identity = historyIdentity(event)
	const owner = props.ecology?.owner
	const graphId = owner ? historyGraphId(owner, identity) : undefined
	const standaloneTimelineEvent = timelineEvent && !owner
	const outcome = event.type === `transaction_outcome` ? event : undefined
	const topOutcome = !timelineEvent && compact && owner !== undefined
	const name = timelineEvent
		? timelineEventTitle(event, props.index)
		: topOutcome
			? `Outcome ${props.index + 1}`
			: token?.key
	const writeCount =
		compact && `subEvents` in event
			? historyWriteCount(event.subEvents)
			: undefined
	const lifecycle =
		timelineDetails &&
		(event.type === `atom_creation` || event.type === `atom_disposal`)
			? event
			: undefined
	const headingName = timelineEvent
		? name!
		: topOutcome
			? `outcome ${props.index + 1}`
			: `event`
	const selected = () =>
		graphId ? props.ecology!.selected === graphId : undefined
	const label = () => (
		<>
			<strong title={timelineEvent ? name : undefined}>{name}</strong>
			{timelineEvent ? (
				<small data-timeline-kind>{timelineEventKind(event)}</small>
			) : (
				!(compact && outcome) && (
					<small>{compact ? event.type.replaceAll(`_`, ` `) : event.type}</small>
				)
			)}
		</>
	)
	const descendants = `subEvents` in event ? event.subEvents : []
	const [getOpen, toggle] = useExpanded(
		props.tools,
		timelineEvent
			? [`timeline-event`, props.timeline!.key, identity]
			: compact
				? compactOutcomePath(identity)
				: [`event`, identity],
		props.initialOpen ?? !compact,
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
						compact={compact}
						timelineChild={timelineDetails}
					/>
				))
			: `Nested events omitted`
	const impact = () => (
		<event-impact
			data-compact={compact || undefined}
			data-indented={topOutcome || timelineEvent || undefined}
		>
			{nested()}
		</event-impact>
	)
	const value = (caption: string, data: unknown, wrap?: boolean) => (
		<OutcomeValue
			tools={props.tools}
			eventId={identity}
			label={caption}
			value={data}
			wrap={wrap}
		/>
	)
	const lifecycleDetails = () => (
		<p data-lifecycle>
			{timelineEvent ? (
				<small>Value</small>
			) : (
				<>
					<strong title={token?.key}>{token?.key}</strong>
					<small>{timelineEventKind(event)}</small>
				</>
			)}
			{lifecycle &&
				`value` in lifecycle &&
				value(`recorded value`, lifecycle.value, true)}
		</p>
	)
	const args = (params: readonly unknown[], full = false) =>
		historyParams(params, full, (data) => describeOutcomeValue(data, full).text)
	const hasMetadata =
		outcome && (outcome.params.length > 0 || outcome.output !== undefined)
	const compactOutcome = ({ params, output }: NonNullable<typeof outcome>) => (
		<>
			{descendants.length > 0 && impact()}
			{hasMetadata && (
				<p
					data-outcome-metadata
					data-metadata-only={writeCount === 0 || undefined}
				>
					{params.length > 0 && (
						<span>
							<span>Args</span>
							<OutcomeValue
								tools={props.tools}
								eventId={identity}
								label="arguments"
								preview={args(params)}
								full={() => args(params, true)}
								wrap={writeCount === 0}
							/>
						</span>
					)}
					{output !== undefined && (
						<span
							data-metadata-block={
								historySnapshotShape(output) ? true : undefined
							}
						>
							<span>Result</span>
							{value(
								`result`,
								output,
								historySnapshotShape(output) !== undefined,
							)}
						</span>
					)}
				</p>
			)}
		</>
	)
	const expandable =
		!(timelineEvent && lifecycle && !(`value` in lifecycle)) &&
		!(
			compact &&
			!timelineEvent &&
			outcome &&
			!hasMetadata &&
			descendants.length === 0
		)
	const details = () => {
		if (outcome) {
			if (compact)
				return (
					<>
						{compactOutcome(outcome)}
						{timelineEvent && (
							<TimelineOutcomeLink
								tools={props.tools}
								event={outcome}
								timelineKey={props.timeline!.key}
								navigate={props.ecology?.viewOutcome}
								render={(source, index) => (
									<event-impact data-compact data-indented>
										<EventView
											key={historyIdentity(source)}
											tools={props.tools}
											event={source}
											index={index}
											compact
											initialOpen
										/>
									</event-impact>
								)}
							/>
						)}
					</>
				)
			return (
				<>
					<p>
						params: <code>{historyParams(outcome.params)}</code>
					</p>
					<p>
						output: <code>{displayValue(outcome.output)}</code>
					</p>
					{impact()}
				</>
			)
		}
		if (lifecycle) return lifecycleDetails()
		if (`update` in event)
			return timelineEvent ? (
				<HistoryWrite
					tools={props.tools}
					eventId={identity}
					event={event}
					showName={false}
				/>
			) : (
				<p data-change>
					<del data-kind={typeof event.update.oldValue}>
						{displayValue(event.update.oldValue)}
					</del>
					<span role="img" aria-label="changed to">
						<EditorIcon name="arrow" />
					</span>
					<ins data-kind={typeof event.update.newValue}>
						{displayValue(event.update.newValue)}
					</ins>
				</p>
			)
		return descendants.length ? (
			impact()
		) : (
			<code>{historyEventPreview(event)}</code>
		)
	}
	return (
		<event-view
			class={css.class}
			data-history-event={identity}
			data-history-graph-id={graphId}
			data-hovered={graphId ? props.ecology!.hovered === graphId : undefined}
			data-selected={selected()}
			data-timeline-event={timelineEvent || undefined}
			data-timeline-state={
				props.timeline && (props.timeline.applied ? `applied` : `future`)
			}
			data-testid={`${event.type === `transaction_outcome` ? `transaction` : `timeline`}-update-${token?.key}-${props.index}`}
		>
			{compact && !timelineEvent && `update` in event ? (
				<HistoryWrite
					tools={props.tools}
					eventId={identity}
					event={event}
					showName
				/>
			) : lifecycle && !timelineEvent ? (
				lifecycleDetails()
			) : (
				<>
					<event-heading>
						<button
							type="button"
							aria-label={`${getOpen() ? `Collapse` : `Expand`} ${headingName}`}
							aria-expanded={getOpen()}
							data-timeline-label={standaloneTimelineEvent || undefined}
							disabled={!expandable}
							onClick={toggle}
						>
							<EditorIcon name={getOpen() ? `collapse` : `expand`} />
							{standaloneTimelineEvent && label()}
						</button>
						{owner ? (
							<button
								type="button"
								data-graph-id={graphId}
								data-history-owner={owner}
								aria-label={`Select ${owner.startsWith(`transaction:`) ? `outcome` : `timeline event`} ${props.index + 1}`}
								aria-pressed={selected()}
								onKeyDown={(keyEvent) => {
									if (
										!timelineEvent ||
										!expandable ||
										keyEvent.key !== `Enter` ||
										keyEvent.ctrlKey ||
										keyEvent.altKey ||
										keyEvent.metaKey ||
										keyEvent.shiftKey
									)
										return
									keyEvent.preventDefault()
									if (!keyEvent.repeat) toggle(keyEvent)
								}}
							>
								{label()}
							</button>
						) : (
							!standaloneTimelineEvent && label()
						)}
						{props.timeline?.redoNext && <small data-redo-next>Redo next</small>}
						{writeCount !== undefined && (
							<small
								data-write-count
							>{`${writeCount} ${writeCount === 1 ? `write` : `writes`}`}</small>
						)}
					</event-heading>
					{getOpen() && details()}
				</>
			)}
		</event-view>
	)
}
