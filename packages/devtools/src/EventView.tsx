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
	historyWriteCount,
	type RecordedEvent,
} from "./history-event.ts"
import {
	describeOutcomeValue,
	historyCollectionChanges,
	historySnapshotShape,
} from "./history-value.ts"
import { historyValuePair } from "./history-value-pair.ts"
import { OutcomeCollectionChange } from "./OutcomeCollectionChange.tsx"
import { OutcomeValue } from "./OutcomeValue.tsx"
import { OutcomeValuePair } from "./OutcomeValuePair.tsx"
import { type EditorTools, useExpanded } from "./store.ts"

export interface EcologyEventInteraction {
	owner: string
	hovered: string | undefined
	selected: string | undefined
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
}): SpaElement {
	const event = props.event
	const token = `token` in event ? event.token : undefined
	const depth = props.depth ?? 0
	const compact = props.compact === true
	const identity = historyIdentity(event)
	const owner = props.ecology?.owner
	const graphId = owner ? historyGraphId(owner, identity) : undefined
	const outcome = event.type === `transaction_outcome` ? event : undefined
	const topOutcome = compact && owner !== undefined
	const name = topOutcome ? `Outcome ${props.index + 1}` : token?.key
	const writeCount =
		compact && outcome ? historyWriteCount(outcome.subEvents) : undefined
	const compactWrite = compact && `update` in event
	const selected = () =>
		graphId ? props.ecology!.selected === graphId : undefined
	const label = () => (
		<>
			<strong>{name}</strong>
			{!(compact && outcome) && (
				<small>{compact ? event.type.replaceAll(`_`, ` `) : event.type}</small>
			)}
		</>
	)
	const descendants = `subEvents` in event ? event.subEvents : []
	const [getOpen, toggle] = useExpanded(
		props.tools,
		[compact ? `ecology-outcome` : `event`, identity],
		!compact,
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
					/>
				))
			: `Nested events omitted`
	const impact = () => (
		<event-impact
			data-compact={compact || undefined}
			data-indented={topOutcome || undefined}
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
	const change = (update: Extract<RecordedEvent, { update: unknown }>) => (
		<p data-change data-compact-write={compact || undefined}>
			{compact && <strong title={update.token.key}>{update.token.key}</strong>}
			<del data-kind={typeof update.update.oldValue}>
				{compact
					? value(`previous value`, update.update.oldValue)
					: displayValue(update.update.oldValue)}
			</del>
			<span role="img" aria-label="changed to">
				<EditorIcon name="arrow" />
			</span>
			<ins data-kind={typeof update.update.newValue}>
				{compact
					? value(`new value`, update.update.newValue)
					: displayValue(update.update.newValue)}
			</ins>
		</p>
	)
	const structured = compactWrite
		? historyCollectionChanges(event.update.oldValue, event.update.newValue)
		: undefined
	const pair =
		compactWrite && !structured
			? historyValuePair(event.update.oldValue, event.update.newValue)
			: undefined
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
	const details = () => {
		if (outcome) {
			if (compact) return compactOutcome(outcome)
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
		if (`update` in event) return change(event)
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
			data-testid={`${event.type === `transaction_outcome` ? `transaction` : `timeline`}-update-${token?.key}-${props.index}`}
		>
			{compactWrite ? (
				structured ? (
					<OutcomeCollectionChange
						tools={props.tools}
						eventId={identity}
						name={event.token.key}
						change={structured}
					/>
				) : pair ? (
					<OutcomeValuePair
						tools={props.tools}
						eventId={identity}
						name={event.token.key}
						pair={pair}
					/>
				) : (
					change(event)
				)
			) : (
				<>
					<event-heading>
						<button
							type="button"
							aria-label={`${getOpen() ? `Collapse` : `Expand`} ${topOutcome ? `outcome ${props.index + 1}` : `event`}`}
							aria-expanded={getOpen()}
							disabled={Boolean(
								compact && outcome && !hasMetadata && descendants.length === 0,
							)}
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
