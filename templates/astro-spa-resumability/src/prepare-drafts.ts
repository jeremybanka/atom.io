import type { AstroStorePreparation } from "@atom.io/spa/astro"
import { disposeFromStore, getFromStore } from "atom.io/internal"
import { createResumption } from "resumability/client"

import { documentIds, draftAtoms } from "./model.ts"

/** Bind the island's initialization scope, then read its initial data. */
export const prepareDrafts: AstroStorePreparation = async (
	store,
	_props,
	context,
) => {
	if (context.element) {
		const scope = createResumption(context.element.closest(`astro-resumption`)!)
		store.runDefault = scope.run
		context.onCleanup(scope.dispose)
	}
	context.onCleanup(() => {
		for (const id of documentIds) disposeFromStore(store, draftAtoms, id)
	})
	await Promise.all(documentIds.map((id) => getFromStore(store, draftAtoms, id)))
}
