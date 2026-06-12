import type { AtomKey, ReadonlySelectorKey, SelectorKey } from "../keys.ts"
import { isStateKey } from "../keys.ts"
import { newest } from "../lineage.ts"
import type { Store } from "../store/index.ts"

export function getSelectorDependencyKeys(
	store: Store,
	key: string,
): (AtomKey<unknown> | ReadonlySelectorKey<unknown> | SelectorKey<unknown>)[] {
	const sources = newest(store)
		.selectorGraph.getRelationEntries({ downstreamSelectorKey: key })
		.filter(([_, { source }]) => source !== key)
		.map(([_, { source }]) => source)
		.filter((source) => isStateKey(store, source))
	return sources
}
