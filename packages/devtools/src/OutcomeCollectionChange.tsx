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
	const { kind, beforeSize, afterSize, entries, truncated } = props.change
	const [open, toggle] = useExpanded(props.tools, [
		`outcome-change`,
		props.eventId,
	])
	const value = (index: number, label: string, data: unknown) => (
		<OutcomeValue
			tools={props.tools}
			eventId={`${props.eventId}:${index}`}
			label={label}
			value={data}
		/>
	)
	const arrow = () => (
		<span role="img" aria-label="changed to">
			<EditorIcon name="arrow" />
		</span>
	)
	return (
		<outcome-collection-change class={css.class}>
			<p data-collection-summary>
				<strong title={props.name}>{props.name}</strong>
				<small>
					{kind}
					{beforeSize !== undefined && (
						<>
							<span>{kind === `Array` ? `length` : `size`}</span>
							<code>{beforeSize}</code>
							{beforeSize !== afterSize && (
								<>
									{arrow()}
									<code>{afterSize}</code>
								</>
							)}
						</>
					)}
				</small>
			</p>
			<entry-changes data-expanded={open()}>
				{(open() ? entries : entries.slice(0, inlineLimit)).map(
					({ label, before, after }, index) => (
						<p key={index} data-entry-change>
							<code title={label}>{label}</code>
							{before ? (
								<del>{value(index, `previous value`, before.value)}</del>
							) : (
								<small>Added</small>
							)}
							{before && after ? arrow() : <span />}
							{after ? (
								<ins>{value(index, `new value`, after.value)}</ins>
							) : (
								<small>Removed</small>
							)}
						</p>
					),
				)}
			</entry-changes>
			{entries.length > inlineLimit && (
				<button type="button" aria-expanded={open()} onClick={toggle}>
					<EditorIcon name={open() ? `collapse` : `expand`} />
					{open()
						? `Show fewer changes`
						: `Show ${entries.length - inlineLimit} more changes`}
				</button>
			)}
			{truncated ? (
				<small data-collection-note>Large value · showing sampled entries</small>
			) : (
				entries.length === 0 && (
					<small data-collection-note>No visible entry changes</small>
				)
			)}
		</outcome-collection-change>
	)
}
