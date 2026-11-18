import type { Store } from "../store/index.ts"
import { recordDependencyChange } from "../store-observation.ts"

export function clearSelectorDependencies(store: Store, key: string): void {
	const upstream = store.selectorGraph.getRelationEntries({
		downstreamSelectorKey: key,
	})
	for (const [dependency, { source }] of upstream) {
		if (source === key) continue
		recordDependencyChange(store, dependency, key)
		store.selectorGraph.delete(dependency, key)
	}
	store.selectorAtoms.delete(key)
}
