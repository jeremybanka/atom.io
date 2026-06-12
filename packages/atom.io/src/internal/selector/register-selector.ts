import type {
	editRelations,
	findRelations,
	findState,
	getInternalRelations,
	ReadableFamilyToken,
	ReadableToken,
	setState,
	WritableFamilyToken,
	WritableToken,
	WriterToolkit,
} from "atom.io"
import type { Canonical } from "atom.io/json"

import { findInStore } from "../families/index.ts"
import { getFallback } from "../get-state/get-fallback.ts"
import { readOrComputeValue } from "../get-state/read-or-compute-value.ts"
import { reduceReference } from "../get-state/reduce-reference.ts"
import {
	editRelationsInStore,
	findRelationsInStore,
	getInternalRelationsFromStore,
} from "../join/index.ts"
import { newest } from "../lineage.ts"
import { getJsonToken } from "../mutable/index.ts"
import { JOIN_OP, operateOnStore } from "../set-state/operate-on-store.ts"
import type { Store } from "../store/index.ts"
import { withdraw } from "../store/index.ts"
import { updateSelectorAtoms } from "./update-selector-atoms.ts"

export function registerSelector(
	store: Store,
	selectorType:
		| `readonly_held_selector`
		| `readonly_pure_selector`
		| `writable_held_selector`
		| `writable_pure_selector`,
	selectorKey: string,
	covered: Set<string>,
): WriterToolkit {
	return {
		get: (
			...params:
				| [ReadableFamilyToken<any, any, any>, Canonical]
				| [ReadableToken<any, any, any>]
		) => {
			const target = newest(store)
			const { token, family, subKey } = reduceReference(store, ...params)
			let dependencyValue: unknown
			if (`counterfeit` in token && family && subKey) {
				dependencyValue = getFallback(store, token, family, subKey)
			} else {
				const dependency = withdraw(store, token)
				dependencyValue = readOrComputeValue(store, dependency)
			}

			store.logger.info(
				`🔌`,
				selectorType,
				selectorKey,
				`registers dependency ( "${token.key}" =`,
				dependencyValue,
				`)`,
			)

			target.selectorGraph.set(
				{
					upstreamSelectorKey: token.key,
					downstreamSelectorKey: selectorKey,
				},
				{
					source: token.key,
				},
			)
			updateSelectorAtoms(store, selectorType, selectorKey, token, covered)
			return dependencyValue
		},
		set: (<T, K extends Canonical>(
			...params:
				| [
						token: WritableFamilyToken<T, K>,
						key: NoInfer<K>,
						value: NoInfer<T> | ((oldValue: T) => NoInfer<T>),
				  ]
				| [
						token: WritableToken<T>,
						value: NoInfer<T> | ((oldValue: T) => NoInfer<T>),
				  ]
		) => {
			const target = newest(store)
			operateOnStore(JOIN_OP, target, ...params)
		}) as typeof setState,
		find: ((...args: Parameters<typeof findState>) =>
			findInStore(store, ...args)) as typeof findState,
		json: (token) => getJsonToken(store, token),
		relations: {
			edit: ((...ps: Parameters<typeof editRelations>) => {
				editRelationsInStore(store, ...ps)
			}) as typeof editRelations,
			find: ((...ps: Parameters<typeof findRelations>) =>
				findRelationsInStore(store, ...ps)) as typeof findRelations,
			internal: ((...ps: Parameters<typeof getInternalRelations>) =>
				getInternalRelationsFromStore(
					store,
					...ps,
				)) as typeof getInternalRelations,
		},
	}
}
