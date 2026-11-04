import type { Selector } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import { subscribeToRootDependency } from "../subscribe/subscribe-to-root-atoms.ts"
import { traceRootSelectorAtoms } from "./trace-selector-atoms.ts"

export function updateRootSubscriptions(
	store: Store,
	selector: Selector<any, any>,
): void {
	const roots = selector.rootSubscriptions
	if (!roots) return
	const dependencies = traceRootSelectorAtoms(store, selector.key)
	for (const [atomKey, unsubscribe] of roots) {
		if (dependencies.has(atomKey)) dependencies.delete(atomKey)
		else {
			unsubscribe()
			roots.delete(atomKey)
		}
	}
	for (const [atomKey, atom] of dependencies)
		roots.set(atomKey, subscribeToRootDependency(store, selector, atom))
}
