import type { VNode } from "@atom.io/spa"
import { useId, useLoadable, useSetter } from "@atom.io/spa"

import type { Draft, Model } from "./model.ts"
import { documentIds } from "./model.ts"

function DraftCard(props: { model: Model; id: number }): VNode {
	const { silo, draftAtoms } = props.model
	const label = useId()
	const fallback: Draft = {
		title: `Draft ${props.id}`,
		body: ``,
		source: `client`,
		revision: `loading`,
	}
	const draft = useLoadable(draftAtoms, props.id, fallback)
	const setDraft = useSetter(draftAtoms, props.id)
	return (
		<article class="draft" data-document={props.id} aria-busy={draft().loading}>
			<header>
				<h3>{draft().value.title}</h3>
				<span class="source" data-source={draft().value.source}>
					{draft().value.source}
				</span>
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
			<footer>
				<button
					onClick={() => {
						silo.resetState(draftAtoms, props.id)
					}}
				>
					Reset draft
				</button>
				<output data-revision>{draft().value.revision}</output>
			</footer>
		</article>
	)
}

export default function Drafts(props: { model: Model }): VNode {
	return (
		<div class="draft-grid">
			{documentIds.map((id) => (
				<DraftCard key={id} model={props.model} id={id} />
			))}
		</div>
	)
}
