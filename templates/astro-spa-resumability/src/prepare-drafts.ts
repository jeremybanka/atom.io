import type { AstroStorePreparation } from "@atom.io/spa/astro"
import { getFromStore } from "atom.io/internal"
import { createResumption } from "resumability/client"
import { documentIds, draftAtoms } from "./model.ts"

export const prepareDrafts: AstroStorePreparation = async (
	store,
	_props,
	{ element, application },
) => {
	if (element) {
		const scope = application.get(createResumption, () => {
			const created = createResumption()
			application.onCleanup(created.dispose)
			store.runDefault = (run) =>
				created.run(run, { resume: application.canResume })
			return created
		})
		scope.add(element.closest(`astro-resumption`)!)
	}
	await Promise.all(documentIds.map((id) => getFromStore(store, draftAtoms, id)))
}
