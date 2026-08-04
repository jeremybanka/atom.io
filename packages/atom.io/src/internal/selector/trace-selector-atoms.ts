import { newest } from "../lineage.ts"
import type { Atom } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import { getSelectorDependencyKeys } from "./get-selector-dependency-keys.ts"

export function traceRootSelectorAtoms(
	store: Store,
	selectorKey: string,
	covered: Set<string> = new Set<string>(),
): Map<string, Atom<any, any>> {
	const target = newest(store)
	const dependencies = getSelectorDependencyKeys(target, selectorKey)

	const roots = new Map<string, Atom<any, any>>()

	while (dependencies.length > 0) {
		const dependencyKey = dependencies.pop()!
		if (covered.has(dependencyKey)) {
			continue
		}
		covered.add(dependencyKey)
		const atom = target.atoms.get(dependencyKey)
		if (atom) {
			roots.set(atom.key, atom)
		} else {
			dependencies.push(...getSelectorDependencyKeys(target, dependencyKey))
		}
	}
	return roots
}
