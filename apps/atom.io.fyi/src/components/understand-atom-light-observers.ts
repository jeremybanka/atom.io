import type { ReadableToken, WritableToken } from "atom.io"
import { type ReadableState, type Store, withdraw } from "atom.io/internal"

export type ObservedCache<T> =
	| {
			status: `cached`
			value: T
	  }
	| {
			status: `missing`
			value: null
	  }

export type ObservedState<T> = {
	cache: ObservedCache<T>
	key: string
	subscriberKeys: readonly string[]
	type:
		| `atom`
		| `mutable_atom`
		| `readonly_held_selector`
		| `readonly_pure_selector`
		| `writable_held_selector`
		| `writable_pure_selector`
}

export type ObservedSelectorGraphEdge = {
	selectorKey: string
	sourceKey: string
}

export type LazinessObservation = {
	computeCount: number
	count: ObservedState<number>
	doubled: ObservedState<number>
	rootObserverKeys: readonly string[]
	selectorGraph: readonly ObservedSelectorGraphEdge[]
	selectorRoots: readonly string[]
}

export type LazinessObserverTarget = {
	computeCount: number
	countAtom: WritableToken<number>
	doubledSelector: ReadableToken<number>
	store: Store
}

export function observeStateCache<T>(
	store: Store,
	token: ReadableToken<T>,
): ObservedCache<T> {
	if (!store.valueMap.has(token.key)) {
		return { status: `missing`, value: null }
	}
	return {
		status: `cached`,
		value: store.valueMap.get(token.key) as T,
	}
}

export function observeState<T>(
	store: Store,
	token: ReadableToken<T>,
): ObservedState<T> {
	const state = withdraw(store, token) as ReadableState<T, unknown>
	return {
		cache: observeStateCache(store, token),
		key: token.key,
		subscriberKeys: [...state.subject.subscribers.keys()].sort(),
		type: state.type,
	}
}

export function observeSelectorGraph(
	store: Store,
	selectorKey: string,
): readonly ObservedSelectorGraphEdge[] {
	return store.selectorGraph
		.getRelationEntries({ downstreamSelectorKey: selectorKey })
		.map(([upstreamSelectorKey, relation]) => ({
			selectorKey,
			sourceKey: relation.source ?? upstreamSelectorKey,
		}))
		.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
}

export function observeSelectorAtoms(
	store: Store,
	selectorKey: string,
): readonly string[] {
	return [...(store.selectorAtoms.getRelatedKeys(selectorKey) ?? [])].sort()
}

export function observeRootObserverKeys(
	store: Store,
	rootKeys: readonly string[],
): readonly string[] {
	const observerKeys = new Set<string>()
	for (const rootKey of rootKeys) {
		const atom = store.atoms.get(rootKey)
		if (!atom) {
			continue
		}
		for (const observerKey of atom.subject.subscribers.keys()) {
			observerKeys.add(observerKey)
		}
	}
	return [...observerKeys].sort()
}

export function observeLaziness(
	target: LazinessObserverTarget,
): LazinessObservation {
	const selectorRoots = observeSelectorAtoms(
		target.store,
		target.doubledSelector.key,
	)
	return {
		computeCount: target.computeCount,
		count: observeState(target.store, target.countAtom),
		doubled: observeState(target.store, target.doubledSelector),
		rootObserverKeys: observeRootObserverKeys(target.store, selectorRoots),
		selectorGraph: observeSelectorGraph(
			target.store,
			target.doubledSelector.key,
		),
		selectorRoots,
	}
}
