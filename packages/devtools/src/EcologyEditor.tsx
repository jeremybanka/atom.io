/** @jsxImportSource @atom.io/spa */
import { onCleanup, onMount, type SpaElement, useId } from "@atom.io/spa"

import type { GraphItem } from "./ecology-graph.ts"
import { animateEcologyEditorHeight, EDITOR_SPRING } from "./ecology-motion.ts"
import css from "./EcologyEditor.module.css"
import {
	EcologyEditorRow,
	type EcologyEditorSection as Section,
} from "./EcologyEditorRow.tsx"
import type { EcologyPresentation } from "./EcologyView.tsx"
import { historyGraphId } from "./history-event.ts"
import type { EditorTools } from "./store.ts"

type Entry =
	| { id: string; heading: string; section: Section }
	| { id: string; item: GraphItem; section: Section }

/** A single keyed row collection keeps drafts mounted when selection moves them between sections. */
export function EcologyEditor(props: {
	tools: EditorTools
	state: EcologyPresentation
	hovered?: string | undefined
	onGenerate(key: string): void
	onViewOutcome(owner: string, outcome: string): boolean
}): SpaElement {
	const layoutGroup = `ecology-editor-${useId()}`
	let editor: HTMLElement | null = null
	let content: HTMLElement | null = null
	onMount(() => {
		onCleanup(animateEcologyEditorHeight(editor!, content!))
	})
	const cachedRows = new Map<
		string,
		{ item: GraphItem; section: Section; node: SpaElement }
	>()
	const release = (id: string) => {
		cachedRows.delete(id)
	}
	const row = (entry: Extract<Entry, { item: GraphItem }>) => {
		const previous = cachedRows.get(entry.id)
		if (previous?.item === entry.item && previous.section === entry.section)
			return previous.node
		const node = (
			<EcologyEditorRow
				key={entry.id}
				tools={props.tools}
				layoutGroup={layoutGroup}
				release={release}
				item={entry.item}
				section={entry.section}
				hovered={
					props.hovered === entry.id ||
					props.hovered?.startsWith(historyGraphId(entry.id, ``))
						? props.hovered
						: undefined
				}
				hidden={
					!props.state.rowIds.has(entry.item.id) &&
					props.state.pinnedKey !== entry.item.key
				}
				pinned={
					!props.state.rowIds.has(entry.item.id) &&
					props.state.pinnedKey === entry.item.key
				}
				state={props.state}
				onGenerate={props.onGenerate}
				onViewOutcome={props.onViewOutcome}
			/>
		)
		Object.freeze(node.props)
		Object.freeze(node)
		cachedRows.set(entry.id, { item: entry.item, section: entry.section, node })
		return node
	}
	const entries = (): Entry[] => {
		const selected = props.state.selected?.id,
			selectedIds = props.state.selectedIds,
			focused = props.state.focused,
			rows = props.state.rows
		const section = (item: GraphItem): Section =>
			selectedIds.has(item.id)
				? `selected`
				: focused?.has(item.id)
					? `related`
					: `rest`
		const groups: Section[] = selected
			? [`selected`, `related`, `rest`]
			: [`rest`]
		return groups.flatMap((group) => [
			{
				id: `heading:${group}`,
				heading:
					group === `selected`
						? selectedIds.size > 1
							? `Selected nodes`
							: `Selected node`
						: group === `related`
							? `Related nodes`
							: selected
								? `Other nodes`
								: `Nodes`,
				section: group,
			},
			...rows
				.filter((item) => section(item) === group)
				.map((item) => ({ id: item.id, item, section: group })),
		])
	}
	return (
		<ecology-editor
			class={css.class}
			ref={(element) => {
				editor = element
			}}
			role="region"
			aria-label="Ecology editor"
			motion:layout={false}
			motion:layoutScroll
			tabIndex={-1}
		>
			<ecology-editor-content
				ref={(element) => {
					content = element
				}}
			>
				<editor-rows>
					{entries().map((entry) =>
						`heading` in entry ? (
							<h3
								key={entry.id}
								data-section-heading={entry.section}
								motion:layout="position"
								motion:layoutTransition={EDITOR_SPRING}
							>
								{entry.heading}
							</h3>
						) : (
							row(entry)
						),
					)}
				</editor-rows>
				{props.state.rowCount > props.state.rowIds.size &&
					props.state.rowIds.size < 500 && (
						<button type="button" data-action="more-rows">
							Show more nodes
						</button>
					)}
				<p hidden={!props.state.empty} data-empty role="status">
					{props.state.emptyText}
				</p>
				<p hidden={!props.state.selectionOutside} data-selection-context>
					{props.state.selected
						? `Selected node is outside the current filter.`
						: `Selection outside this captured snapshot`}
				</p>
			</ecology-editor-content>
		</ecology-editor>
	)
}
