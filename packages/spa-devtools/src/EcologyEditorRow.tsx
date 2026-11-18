/** @jsxImportSource @atom.io/spa */
import { onCleanup, type SpaElement } from "@atom.io/spa"
import { deposit } from "atom.io/internal"

import type { EcologyNode } from "./ecology.ts"
import type { GraphItem } from "./ecology-graph.ts"
import { EDITOR_SPRING } from "./ecology-motion.ts"
import css from "./EcologyEditorRow.module.css"
import { EcologyNodeName } from "./EcologyNodeName.tsx"
import type { EcologyPresentation } from "./EcologyView.tsx"
import { StateLeaf } from "./StateLeaf.tsx"
import type { Tools } from "./store.ts"

export type EcologyEditorSection = `selected` | `related` | `rest`
export function EcologyEditorRow(props: {
	layoutGroup: string
	release(id: string): void
	tools: Tools
	item: GraphItem
	section: EcologyEditorSection
	hidden: boolean
	pinned: boolean
	state: EcologyPresentation
	onGenerate(key: string): void
}): SpaElement {
	const rowId = props.item.id
	onCleanup(() => {
		props.release(rowId)
	})
	const definitions = new WeakMap<object, number>()
	let serial = 0
	let generated = 0
	const definition = () =>
		props.tools.store.atoms.get(props.item.key) ??
		props.tools.store.readonlySelectors.get(props.item.key) ??
		props.tools.store.writableSelectors.get(props.item.key)
	const identity = () => {
		const value = definition()!
		let id = definitions.get(value)
		if (id === undefined) {
			id = serial++
			definitions.set(value, id)
		}
		return `${id}:${generated}`
	}
	const family = () =>
		`memberKeys` in props.item.source ? props.item.source : undefined
	const label = () => (
		<EcologyNodeName item={props.item} selected={props.section === `selected`} />
	)
	return (
		<ecology-editor-row
			class={css.class}
			hidden={props.hidden}
			motion:layout="position"
			motion:layoutId={props.item.id}
			motion:layoutGroup={props.layoutGroup}
			motion:layoutTransition={EDITOR_SPRING}
			data-section={props.section}
			data-selection-anchor={props.state.selected?.id === props.item.id}
			data-row-id={props.item.id}
			data-grouped={
				`family` in props.item.source && Boolean(props.item.source.family)
			}
			style={`--ecology-color: ${props.item.color}`}
		>
			{family() ? (
				<node-heading>
					<button
						type="button"
						data-action="expand"
						data-family-key={props.item.key}
						aria-label={`${props.state.expanded.has(props.item.key) ? `Collapse` : `Expand`} ${props.item.key}`}
						aria-expanded={props.state.expanded.has(props.item.key)}
					>
						{props.state.expanded.has(props.item.key) ? `▾` : `▸`}
					</button>
					{label()}
					<small>{`${family()!.memberCount}${family()!.countComplete ? `` : `+`} members`}</small>
				</node-heading>
			) : definition() ? (
				<StateLeaf
					key={identity()}
					tools={props.tools}
					token={deposit(definition()!)}
					retained
					cachedOnly
					capture={props.item.source}
					label={label()}
					onGenerate={() => {
						generated++
						props.onGenerate(props.item.key)
					}}
				/>
			) : (
				<p>State was disposed. Refresh to update the snapshot.</p>
			)}
			{props.pinned && (
				<small data-pinned>Unfinished edit · outside filter</small>
			)}
			{props.state.selected?.id === props.item.id && (
				<details data-node-details>
					<summary>Node details</summary>
					<p>{props.item.detail}</p>
					{family() ? (
						<>
							<p>{`${family()!.memberCount}${family()!.countComplete ? `` : `+`} instantiated members`}</p>
							<button
								type="button"
								data-action="expand"
								data-family-key={props.item.key}
							>
								{props.state.expanded.has(props.item.key)
									? `Collapse family`
									: `Expand family`}
							</button>
						</>
					) : (
						<>
							<p>{`${props.item.source.type.startsWith(`readonly`) ? `Readonly` : `Writable`} ${props.item.kind}`}</p>
							<p>{`Dependencies: ${(props.item.source as EcologyNode).dependencies}${(props.item.source as EcologyNode).dependenciesTruncated ? ` (truncated)` : ``}`}</p>
							<button type="button" data-action="trace">
								Trace observed roots
							</button>
						</>
					)}
					<p>{props.state.traceStatus}</p>
					<p>{`Observed snapshot ${props.state.capturedAt}. Retained dependencies may be stale or incomplete.`}</p>
				</details>
			)}
		</ecology-editor-row>
	)
}
