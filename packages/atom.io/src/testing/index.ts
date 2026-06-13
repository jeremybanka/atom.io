import type { ReadableFamilyToken, ReadableToken, TimelineToken } from "atom.io"
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

export type TimelineState = {
	at: number
	length: number
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
 * Read a timeline's current history position.
 */
export function timelineState(
	token: TimelineToken<any>,
	store: RootStore = IMPLICIT.STORE,
): TimelineState {
	const timeline = withdraw(store, token)
	return {
		at: timeline.at,
		length: timeline.history.length,
	}
}

/**
 * Check whether a store currently retains any state values.
 *
 * Useful for asserting that a failed transaction did not commit values, while
 * keeping tests away from the store's internal value containers.
 */
export function storeHasStateValues(store: RootStore = IMPLICIT.STORE): boolean {
	return store.valueMap.size > 0
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
