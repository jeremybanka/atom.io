/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import type { GraphItem } from "./ecology-graph.ts"
import css from "./EcologyNodeName.module.css"

/** The selection control owns its styling wherever a state editor places its label. */
export function EcologyNodeName(props: {
	item: GraphItem
	selected: boolean
}): SpaElement {
	return (
		<ecology-node-name class={css.class}>
			<button
				type="button"
				data-action="select"
				data-graph-id={props.item.id}
				aria-pressed={props.selected}
				title={`${props.item.key}\n${props.item.source.type}`}
			>
				{props.item.label}
			</button>
		</ecology-node-name>
	)
}
