/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { EditorIcon } from "./EditorIcon.tsx"
import {
	changedRecordField,
	type HistoryCollectionChange,
} from "./history-value.ts"
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
		comparisonLimited,
	} = props.change
	const [open, toggle] = useExpanded(props.tools, [
		`outcome-change`,
		props.eventId,
	])
	const changes = entries.filter((entry) => entry.changed)
	const keepSpliceContext =
		entries.length <= inlineLimit + 1 &&
		entries.some((entry) => entry.beforeLabel !== entry.afterLabel)
	const preview = keepSpliceContext
		? entries
		: (entries.length > inlineLimit && changes.length ? changes : entries).slice(
				0,
				inlineLimit,
			)
	const more = entries.length - preview.length
	const keyWidth = Math.min(
		32,
		Math.max(0, ...entries.map((entry) => entry.label.length)),
	)
	const length =
		kind === `Array`
			? Math.max(beforeSize!, afterSize!)
			: entries.length + Number(truncated)
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
	const gap = (start: number) => (
		<tr key={`gap:${start}`} data-snapshot-gap>
			{punctuation(
				`before`,
				beforeEmpty || (kind === `Array` && start >= beforeSize!) ? `` : `…`,
			)}
			{punctuation(
				`after`,
				afterEmpty || (kind === `Array` && start >= afterSize!) ? `` : `…`,
			)}
		</tr>
	)
	const cell = (
		entry: HistoryCollectionChange[`entries`][number],
		index: number,
		side: `before` | `after`,
	) => {
		const slot = entry[side]
		const label =
			(side === `before` ? entry.beforeLabel : entry.afterLabel) ?? entry.label
		const field =
			kind === `Array` && entry.changed && entry.before && entry.after
				? changedRecordField(entry.before.value, entry.after.value)
				: undefined
		return (
			<td
				data-snapshot-side={side}
				data-snapshot-diff={slot && entry.changed ? side : undefined}
			>
				{slot && (
					<snapshot-entry>
						{label && (
							<code title={label} data-index={kind === `Array` || undefined}>
								{label}
							</code>
						)}
						<OutcomeValue
							tools={props.tools}
							eventId={`${props.eventId}:${index}`}
							label={side === `before` ? `previous value` : `new value`}
							value={slot.value}
							summary={field && `${field.label}: ${field[side]}`}
						/>
					</snapshot-entry>
				)}
			</td>
		)
	}
	const rows = () => {
		const visible = open() ? entries : preview
		const result: SpaElement[] = []
		let position = 0
		for (const entry of visible) {
			const index = entry.position
			if (position < index) result.push(gap(position))
			result.push(
				<tr key={index} data-snapshot-entry>
					{cell(entry, index, `before`)}
					{cell(entry, index, `after`)}
				</tr>,
			)
			position = index + 1
		}
		if (position < length) result.push(gap(position))
		return result
	}
	return (
		<outcome-collection-change class={css.class}>
			<p data-collection-summary>
				<strong title={props.name}>{props.name}</strong>
				<small>{kind}</small>
			</p>
			<snapshot-comparison
				data-expanded={open()}
				style={`--snapshot-key-width: ${keyWidth}ch`}
			>
				<table aria-label={`${props.name} snapshots`}>
					<thead>
						<tr>
							{heading(`Before`, beforeSize)}
							{heading(`After`, afterSize)}
						</tr>
					</thead>
					<tbody>
						{punctuationRow(left, left + right)}
						{rows()}
						{(!beforeEmpty || !afterEmpty) && punctuationRow(right)}
					</tbody>
				</table>
			</snapshot-comparison>
			{more > 0 && (
				<button type="button" aria-expanded={open()} onClick={toggle}>
					<EditorIcon name={open() ? `collapse` : `expand`} />
					{open() ? `Show fewer rows` : `Show ${more} more rows`}
				</button>
			)}
			{truncated && (
				<small data-collection-note>
					{comparisonLimited
						? `Large array · comparison sampled`
						: `Large value · showing sampled entries`}
				</small>
			)}
		</outcome-collection-change>
	)
}
