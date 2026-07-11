import type { ReadableToken } from "atom.io"

import { newest } from "../lineage.ts"
import type { Store } from "../store/index.ts"
import type { SelectorDependencyTracker } from "./selector-dependency-tracker.ts"
import { traceRootSelectorAtoms } from "./trace-selector-atoms.ts"

export function updateSelectorAtoms(
	store: Store,
	selectorType:
		| `readonly_held_selector`
		| `readonly_pure_selector`
		| `writable_held_selector`
		| `writable_pure_selector`,
	selectorKey: string,
	dependency: ReadableToken<unknown, any, unknown>,
	dependencies: SelectorDependencyTracker,
): void {
	const target = newest(store)
	const { type: dependencyType, key: dependencyKey } = dependency
	if (dependencyType === `atom` || dependencyType === `mutable_atom`) {
		dependencies.recordRootAtom(target, dependencyKey)
		store.logger.info(
			`🔍`,
			selectorType,
			selectorKey,
			`discovers root atom "${dependencyKey}"`,
		)
	} else {
		const cachedRootKeys = target.selectorAtoms.getRelatedKeys(dependencyKey)
		const rootKeys = cachedRootKeys
			? new Map(
					[...cachedRootKeys].flatMap((atomKey) => {
						const atom = target.atoms.get(atomKey)
						return atom ? [[atomKey, atom] as const] : []
					}),
				)
			: traceRootSelectorAtoms(store, dependencyKey, dependencies.covered)
		store.logger.info(
			`🔍`,
			selectorType,
			selectorKey,
			`discovers root atoms: [ ${[...rootKeys.values()]
				.map((root) => `"${root.key}"`)
				.join(`, `)} ]`,
		)
		for (const { key: atomKey } of rootKeys.values()) {
			dependencies.recordRootAtom(target, atomKey)
		}
	}
	dependencies.covered.add(dependencyKey)
}
