/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import { deposit } from "atom.io/internal"

import css from "./SearchLiveEditor.module.css"
import { StateLeaf } from "./StateLeaf.tsx"
import type { Tools } from "./store.ts"

export function SearchLiveEditor(props: {
	tools: Tools
	stateKey?: string | undefined
}): SpaElement {
	const token = () => {
		const key = props.stateKey,
			store = props.tools.store
		const definition = key
			? (store.atoms.get(key) ??
				store.readonlySelectors.get(key) ??
				store.writableSelectors.get(key))
			: undefined
		return definition ? deposit(definition) : undefined
	}
	return (
		<search-live-editor class={css.class}>
			{token() ? (
				<StateLeaf
					retained
					key={props.stateKey}
					tools={props.tools}
					token={token()!}
				/>
			) : props.stateKey ? (
				<p>State disposed. Refresh to update the snapshot.</p>
			) : null}
		</search-live-editor>
	)
}
