import type { VNode } from "@atom.io/spa"
import { useId, useLoadable, useSetter, useStore } from "@atom.io/spa"
import { resetInStore } from "atom.io/internal"

import type { Draft } from "./api.ts"
import { documentIds, draftAtoms } from "./model.ts"
import { prepareDrafts } from "./prepare-drafts.ts"

function DraftCard(props: { id: number }): VNode {
	const store = useStore()
	const label = useId()
	const fallback: Draft = {
		id: props.id,
		title: `Draft ${props.id}`,
		body: ``,
		revision: `00000000-0000-0000-0000-000000000000`,
	}
	const draft = useLoadable(draftAtoms, props.id, fallback)
	const setDraft = useSetter(draftAtoms, props.id)
	return (
		<article class="draft" data-document={props.id} aria-busy={draft().loading}>
			<header>
				<h3>{draft().value.title}</h3>
				<span class="source">{draft().loading ? `Refreshing…` : `Ready`}</span>
			</header>
			<label for={label}>Your note</label>
			<textarea
				id={label}
				value={draft().value.body}
				onInput={(event) => {
					setDraft({ ...draft().value, body: event.currentTarget.value })
				}}
			/>
			<p class="preview" data-preview>
				{draft().value.body}
			</p>
			<p role="status">{draft().error?.message ?? ``}</p>
			<footer>
				<button
					onClick={() => {
						resetInStore(store, draftAtoms, props.id)
					}}
				>
					Refresh from database
				</button>
				<output data-revision>{draft().value.revision}</output>
			</footer>
		</article>
	)
}

export default function Drafts(props: { id: string }): VNode {
	return (
		<div class="draft-grid" data-island={props.id}>
			{documentIds.map((id) => (
				<DraftCard key={id} id={id} />
			))}
		</div>
	)
}

Drafts.prepareStore = prepareDrafts
