/** @jsxImportSource @atom.io/spa */
import type { Children, SpaElement } from "@atom.io/spa"
import { onCleanup, onCommit, onMount } from "@atom.io/spa"

import type { SearchHit, SearchView as View } from "./search.ts"
import { createStateSearch, type SearchContext } from "./search-controller.ts"
import { SearchContextNotice } from "./SearchContextNotice.tsx"
import { SearchControls } from "./SearchControls.tsx"
import { SearchLiveEditor } from "./SearchLiveEditor.tsx"
import css from "./SearchView.module.css"
import { type Tools, usePresentation } from "./store.ts"

export interface SearchPresentation {
	hits: SearchHit[]
	busy: boolean
	summary: string
	metadata: string
	notes: string
	message: string
	detail: string
	selected?: SearchHit | undefined
	existing: boolean
	liveKey?: string | undefined
	pinned: boolean
	retained: boolean
}
export function SearchView(props: {
	tools: Tools
	type: View
	context: SearchContext
	children?: Children
}): SpaElement {
	const presentation = usePresentation<SearchPresentation>(props.tools.store, {
		hits: [],
		selected: undefined,
		liveKey: undefined,
		busy: false,
		summary: ``,
		metadata: ``,
		notes: ``,
		message: ``,
		detail: ``,
		existing: false,
		pinned: false,
		retained: false,
	})
	let host: HTMLElement | null = null
	let controller: ReturnType<typeof createStateSearch> | undefined
	const state = presentation.read
	const publish = presentation.update
	onMount(() => {
		controller = createStateSearch(
			host!,
			props.tools.store,
			props.type,
			props.context,
			publish,
		)
		onCleanup(controller.dispose)
	})
	onCommit(presentation.version, () => {
		controller?.committed()
	})
	return (
		<search-view
			class={css.class}
			ref={(element) => {
				host = element
			}}
		>
			<SearchControls type={props.type} state={state()} />
			<SearchContextNotice shown={state().retained} />
			<SearchLiveEditor tools={props.tools} stateKey={state().liveKey} />
			{props.children}
		</search-view>
	)
}
