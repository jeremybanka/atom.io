import type { ReadableFamilyToken, ReadableToken } from "atom.io"
import type { RootStore } from "atom.io/internal"
import { IMPLICIT, seekInStore, Store, withdraw } from "atom.io/internal"
import type { Canonical } from "atom.io/json"

/**
 * A snapshot of the store state that can be restored.
 */
export type Snapshot = {
	restore(): void
	store: RootStore
}

/**
 * Capture the current store structure and return a function that restores it.
 */
export function takeSnapshot(store: RootStore = IMPLICIT.STORE): Snapshot {
	const baseConfig = IMPLICIT.STORE.config
	const templateConfig = { ...baseConfig, name: `TEMPLATE` }
	const template = new Store(templateConfig, store) as RootStore
	return {
		restore(): void {
			globalThis.ATOM_IO_IMPLICIT_STORE = new Store(
				baseConfig,
				template,
			) as RootStore
		},
		store: template,
	}
}

/**
 * Check whether a state currently exists in a store without creating it.
 *
 * Useful for asserting that disposal released a state, while keeping tests away
 * from the store's internal data structures.
 */
export function stateExists(
	token: ReadableToken<any, any, any>,
	store?: RootStore,
): boolean
export function stateExists<K extends Canonical>(
	family: ReadableFamilyToken<any, K, any>,
	key: K,
	store?: RootStore,
): boolean
export function stateExists<K extends Canonical>(
	tokenOrFamily: ReadableFamilyToken<any, K, any> | ReadableToken<any, any, any>,
	keyOrStore?: K | RootStore,
	maybeStore?: RootStore,
): boolean {
	switch (tokenOrFamily.type) {
		case `atom_family`:
		case `mutable_atom_family`:
		case `readonly_held_selector_family`:
		case `readonly_pure_selector_family`:
		case `writable_held_selector_family`:
		case `writable_pure_selector_family`: {
			const key = keyOrStore as K
			const store = maybeStore ?? IMPLICIT.STORE
			return seekInStore(store, tokenOrFamily, key) !== undefined
		}
		default: {
			const store = (keyOrStore as RootStore | undefined) ?? IMPLICIT.STORE
			try {
				withdraw(store, tokenOrFamily)
				return true
			} catch {
				return false
			}
		}
	}
}
