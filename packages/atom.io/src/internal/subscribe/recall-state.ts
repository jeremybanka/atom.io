import { newest } from "../lineage.ts"
import type { ReadableState } from "../state-types.ts"
import type { Store } from "../store/index.ts"

export function recallState<T, E>(store: Store, state: ReadableState<T, E>): T {
	const target = newest(store)
	if (target.operation.open) {
		return target.operation.prev.get(state.key)
	}
	return target.valueMap.get(state.key)
}
