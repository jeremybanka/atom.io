import { newest } from "../lineage.ts"
import type { Atom } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import { traceRootSelectorAtoms } from "./trace-selector-atoms.ts"

export function getSelectorRootAtoms(
	store: Store,
	selectorKey: string,
): Map<string, Atom<any, any>> {
	const target = newest(store)
	const cachedRootKeys = target.selectorAtoms.getRelatedKeys(selectorKey)
	if (cachedRootKeys) {
		const roots = new Map<string, Atom<any, any>>()
		for (const atomKey of cachedRootKeys) {
			const atom = target.atoms.get(atomKey)
			if (atom) roots.set(atomKey, atom)
		}
		return roots
	}
	return traceRootSelectorAtoms(target, selectorKey)
}
