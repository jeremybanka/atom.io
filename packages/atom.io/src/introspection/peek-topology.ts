import type { ReadableState, RootStore } from "atom.io/internal"

/** Read a registered definition. Treat the returned store record as read-only. */
export function peekStateDefinition(
	store: RootStore,
	key: string,
): Readonly<ReadableState<any, any>> | undefined {
	return (
		store.atoms.get(key) ??
		store.readonlySelectors.get(key) ??
		store.writableSelectors.get(key)
	)
}

/** Read retained incoming edges, with a budget that counts all examined relations. */
export function peekDependencies(
	store: RootStore,
	key: string,
	budget: number = Infinity,
): {
	dependencies: string[]
	inspected: number
	total: number
} {
	const related = store.selectorGraph.getRelatedKeys(key)
	const neighbors = related?.values()
	const dependencies: string[] = []
	let inspected = 0
	while (neighbors && inspected < budget) {
		const entry = neighbors.next()
		if (entry.done) break
		inspected++
		if (store.selectorGraph.getContent(entry.value, key)?.source === entry.value)
			dependencies.push(entry.value)
	}
	return { dependencies, inspected, total: related?.size ?? 0 }
}
