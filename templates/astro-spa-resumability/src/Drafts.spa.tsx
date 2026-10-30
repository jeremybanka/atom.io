import type { VNode } from "@atom.io/spa"
import { useId, useLoadable, useSetter, useStore } from "@atom.io/spa"
import type { AstroStoreContext } from "@atom.io/spa/astro"
import type { RootStore } from "atom.io/internal"
import { createResumption } from "resumability/client"

import type { Draft, Model } from "./model.ts"
import { createModel, documentIds } from "./model.ts"

const models = new WeakMap<RootStore, Model>()

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

export default function Drafts(props: { id: string }): VNode {
	const model = models.get(useStore())!
	return (
		<div class="draft-grid" data-island={props.id}>
			{documentIds.map((id) => (
				<DraftCard key={id} model={model} id={id} />
			))}
		</div>
	)
}

Drafts.createStore = async (
	_props: { id: string },
	context: AstroStoreContext,
): Promise<RootStore> => {
	const scope = context.element
		? createResumption(context.element.closest(`astro-resumption`)!)
		: undefined
	if (scope)
		context.onCleanup(() => {
			scope.dispose()
		})
	const model = createModel(scope)
	models.set(model.silo.store, model)
	context.onCleanup(() => {
		models.delete(model.silo.store)
		model.dispose()
	})
	await model.prepare()
	return model.silo.store
}
