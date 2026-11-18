import type { RootStore } from "atom.io/internal"

export type CachedState =
	| { readonly present: false; readonly value?: undefined }
	| { readonly present: true; readonly value: unknown }

/**
 * Inspect the root cache by key without evaluating state or consulting
 * transaction children. The value is the raw cache reference, including any
 * pending promise. Inspect it without mutating it.
 */
export function peekState(store: RootStore, key: string): CachedState {
	const value: unknown = store.valueMap.get(key)
	return value !== undefined || store.valueMap.has(key)
		? { present: true, value }
		: { present: false }
}
