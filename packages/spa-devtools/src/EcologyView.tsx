import type { SpaElement } from "@atom.io/spa"
import { onCleanup, onMount, render } from "@atom.io/spa"
import { deposit } from "atom.io/internal"

import { createEcologyController } from "./ecology-controller.ts"
import type { GraphContext } from "./ecology-graph.ts"
import { StateLeaf } from "./Indexes.tsx"
import type { Tools } from "./store.ts"

export function EcologyView(props: {
	tools: Tools
	context: GraphContext
}): SpaElement {
	let host: HTMLElement | null = null
	onMount(() => {
		onCleanup(
			createEcologyController(
				host!,
				props.tools.store,
				props.context,
				(key, target) => {
					const store = props.tools.store
					const state =
						store.atoms.get(key) ??
						store.readonlySelectors.get(key) ??
						store.writableSelectors.get(key)
					if (!state) {
						target.textContent = `State was disposed. Refresh to update the snapshot.`
						return () => {}
					}
					const root = render(
						() => <StateLeaf tools={props.tools} token={deposit(state)} />,
						target,
						{ store },
					)
					return root.dispose
				},
			),
		)
	})
	return (
		<article
			ref={(element) => {
				host = element
			}}
			data-testid="ecology-view"
		/>
	)
}
