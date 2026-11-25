/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { EditorIcon } from "./EditorIcon.tsx"
import type { HistoryCollectionChange } from "./history-value.ts"
import css from "./OutcomeCollectionChange.module.css"
import { OutcomeValue } from "./OutcomeValue.tsx"
import { type EditorTools, useExpanded } from "./store.ts"

const inlineLimit = 3

export function OutcomeCollectionChange(props: {
	tools: EditorTools
	eventId: string
	name: string
	change: HistoryCollectionChange
}): SpaElement {
	const {
		kind,
		beforeSize,
		afterSize,
		beforeEmpty,
		afterEmpty,
		entries,
		truncated,
	} = props.change
	const [open, toggle] = useExpanded(props.tools, [
		`outcome-change`,
		props.eventId,
	])
	const firstChange = entries.findIndex((entry) => entry.changed)
	const start = Math.max(0, firstChange - inlineLimit + 1)
	const visibleStart = () => (open() ? 0 : start)
	const visibleEnd = () =>
		open() ? entries.length : Math.min(entries.length, start + inlineLimit)
	const [left, right] = kind === `Array` ? [`[`, `]`] : [`{`, `}`]
	const heading = (side: string, size: number | undefined) => (
		<th scope="col">
			<snapshot-heading>
				<span>{side}</span>
				{size !== undefined && (
					<small>
						{kind === `Array` ? `length` : `size`} {size}
					</small>
				)}
			</snapshot-heading>
		</th>
	)
	const punctuation = (side: `before` | `after`, value: string) => (
		<td data-snapshot-side={side}>
			<code>{value}</code>
		</td>
	)
	const punctuationRow = (value: string, empty = ``) => (
		<tr data-snapshot-punctuation>
			{punctuation(`before`, beforeEmpty ? empty : value)}
			{punctuation(`after`, afterEmpty ? empty : value)}
		</tr>
	)
	const cell = (
		entry: HistoryCollectionChange[`entries`][number],
		index: number,
		side: `before` | `after`,
	) => {
		const slot = entry[side]
		return (
			<td
				data-snapshot-side={side}
				data-snapshot-diff={slot && entry.changed ? side : undefined}
			>
				{slot && (
					<snapshot-entry>
						{entry.label && <code title={entry.label}>{entry.label}</code>}
						<OutcomeValue
							tools={props.tools}
							eventId={`${props.eventId}:${index}`}
							label={side === `before` ? `previous value` : `new value`}
							value={slot.value}
						/>
					</snapshot-entry>
				)}
			</td>
		)
	}
	return (
		<outcome-collection-change class={css.class}>
			<p data-collection-summary>
				<strong title={props.name}>{props.name}</strong>
				<small>{kind}</small>
			</p>
			<snapshot-comparison data-expanded={open()}>
				<table aria-label={`${props.name} snapshots`}>
					<thead>
						<tr>
							{heading(`Before`, beforeSize)}
							{heading(`After`, afterSize)}
						</tr>
					</thead>
					<tbody>
						{punctuationRow(left, left + right)}
						{visibleStart() > 0 && punctuationRow(`…`)}
						{entries.slice(visibleStart(), visibleEnd()).map((entry, offset) => {
							const index = visibleStart() + offset
							return (
								<tr key={index} data-snapshot-entry>
									{cell(entry, index, `before`)}
									{cell(entry, index, `after`)}
								</tr>
							)
						})}
						{(visibleEnd() < entries.length || truncated) && punctuationRow(`…`)}
						{(!beforeEmpty || !afterEmpty) && punctuationRow(right)}
					</tbody>
				</table>
			</snapshot-comparison>
			{entries.length > inlineLimit && (
				<button type="button" aria-expanded={open()} onClick={toggle}>
					<EditorIcon name={open() ? `collapse` : `expand`} />
					{open()
						? `Show fewer rows`
						: `Show ${entries.length - inlineLimit} more rows`}
				</button>
			)}
			{truncated && (
				<small data-collection-note>Large value · showing sampled entries</small>
			)}
		</outcome-collection-change>
	)
}
