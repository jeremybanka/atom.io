/** @jsxImportSource @atom.io/spa */
import { onCleanup, type SpaElement } from "@atom.io/spa"
import { deposit } from "atom.io/internal"
import { peekStateDefinition } from "atom.io/introspection"

import type { GraphItem } from "./ecology-graph.ts"
import { EDITOR_SPRING } from "./ecology-motion.ts"
import css from "./EcologyEditorRow.module.css"
import { EcologyNodeName } from "./EcologyNodeName.tsx"
import { EcologyOperationHistory } from "./EcologyOperationHistory.tsx"
import { EcologyPrimitiveIcon } from "./EcologyPrimitiveIcon.tsx"
import type { EcologyPresentation } from "./EcologyView.tsx"
import { EditorIcon } from "./EditorIcon.tsx"
import { StateLeaf } from "./StateLeaf.tsx"
import type { EditorTools } from "./store.ts"

export type EcologyEditorSection = `selected` | `related` | `rest`
export function EcologyEditorRow(props: {
	layoutGroup: string
	release(id: string): void
	tools: EditorTools
	item: GraphItem
	section: EcologyEditorSection
	hovered: boolean
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
	const definition = () => peekStateDefinition(props.tools.store, props.item.key)
	const identity = () => {
		const value = definition()!
		let id = definitions.get(value)
		if (id === undefined) {
			id = serial++
			definitions.set(value, id)
		}
		return id
	}
	const family = () =>
		`memberKeys` in props.item.source ? props.item.source : undefined
	const operation = () => {
		const source = props.item.source
		return `kind` in source || `memberKeys` in source ? undefined : source
	}
	const expanded = () => props.state.expanded.has(props.item.id)
	const label = () => (
		<EcologyNodeName
			item={props.item}
			selected={props.section === `selected`}
			expanded={operation() ? expanded() : undefined}
		/>
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
			data-hovered={props.hovered}
			data-grouped={
				`family` in props.item.source && Boolean(props.item.source.family)
			}
			style={`--ecology-color: ${props.item.color}`}
		>
			<EcologyPrimitiveIcon
				source={props.item.source}
				placement={family() || operation() ? `heading` : `row`}
			/>
			{family() ? (
				<node-heading>
					<button
						type="button"
						data-action="expand"
						data-family-id={props.item.id}
						aria-label={`${expanded() ? `Collapse` : `Expand`} ${props.item.key}`}
						aria-expanded={expanded()}
					>
						<EditorIcon name={expanded() ? `collapse` : `expand`} />
					</button>
					{label()}
					<small>{`${family()!.memberCount}${family()!.countComplete ? `` : `+`} members`}</small>
				</node-heading>
			) : operation() ? (
				<EcologyOperationHistory
					tools={props.tools}
					operation={operation()!}
					id={props.item.id}
					expanded={expanded()}
					label={label()}
				/>
			) : definition() ? (
				<StateLeaf
					key={identity()}
					tools={props.tools}
					token={deposit(definition()!)}
					retained
					cachedOnly
					capture={props.item.source}
					revision={props.state.activity.get(props.item.id)?.revision}
					label={label()}
					onInitialize={() => {
						props.onGenerate(props.item.key)
					}}
				/>
			) : (
				<p>State was disposed.</p>
			)}
			{props.pinned && (
				<small data-pinned>Unfinished edit · outside filter</small>
			)}
		</ecology-editor-row>
	)
}
