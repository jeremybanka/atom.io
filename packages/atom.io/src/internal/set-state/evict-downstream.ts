import { evictCachedValue } from "../caching.ts"
import { newest } from "../lineage.ts"
import { isDone, markDone } from "../operation.ts"
import type { Atom } from "../state-types.ts"
import type { Store } from "../store/index.ts"

export function evictDownstreamFromAtom(
	store: Store,
	atom: Atom<any, any>,
): void {
	const target = newest(store)
	const { key, type } = atom
	const downstreamKeys = target.selectorAtoms.getRelatedKeys(key)
	target.logger.info(
		`🧹`,
		type,
		key,
		downstreamKeys
			? `evicting ${downstreamKeys.size} states downstream:`
			: `no downstream states`,
		downstreamKeys ?? `to evict`,
	)
	if (downstreamKeys) {
		if (target.operation.open) {
			if (target.logger.isEnabled?.(`info`) !== false) {
				target.logger.info(
					`🧹`,
					type,
					key,
					`[ ${[...target.operation.done].join(`, `)} ] already done`,
				)
			}
		}
		for (const downstreamKey of downstreamKeys) {
			if (isDone(target, downstreamKey)) {
				continue
			}
			evictCachedValue(target, downstreamKey)
			markDone(target, downstreamKey)
		}
	}
}

export function evictDownstreamFromSelector(
	store: Store,
	selectorKey: string,
): void {
	const target = newest(store)
	const relationEntries = target.selectorGraph
		.getRelationEntries({
			upstreamSelectorKey: selectorKey,
		})
		.filter(([_, { source }]) => source === selectorKey)
	for (const [downstreamSelectorKey] of relationEntries) {
		if (isDone(target, downstreamSelectorKey)) {
			continue
		}
		evictCachedValue(target, downstreamSelectorKey)
		markDone(target, downstreamSelectorKey)
		evictDownstreamFromSelector(store, downstreamSelectorKey)
	}
}
