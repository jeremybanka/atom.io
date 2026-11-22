/** @jsxImportSource @atom.io/spa */
import "./globals.css"

import { type SpaElement, useGetter } from "@atom.io/spa"
import type { RootStore } from "atom.io/internal"

import { createGraphContext } from "./ecology-graph.ts"
import { EcologyView } from "./EcologyView.tsx"
import { useEditorTools } from "./store.ts"

export function EcologyPanel(props: { store: RootStore }): SpaElement {
	const tools = useEditorTools(props.store)
	const error = useGetter(tools.error)
	const context = createGraphContext()
	let panel: HTMLElement | null = null
	return (
		<ecology-panel
			ref={(node) => {
				panel = node
			}}
		>
			{error() ? <p role="alert">{error()}</p> : null}
			<EcologyView tools={tools} context={context} scope={() => panel!} />
		</ecology-panel>
	)
}
