import type { ReadableFamilyToken, ReadableToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import type { RootStore } from "atom.io/internal"
import { IMPLICIT, seekInStore, withdraw } from "atom.io/internal"

/**
 * Check whether a state currently exists in a store without creating it.
 *
 * Useful for asserting that disposal released a state, while keeping tests away
 * from the store's internal data structures.
 */
export function stateExists(token: ReadableToken<any, any, any>): boolean
export function stateExists<K extends Canonical>(
	family: ReadableFamilyToken<any, K, any>,
	key: NoInfer<K>,
): boolean
export function stateExists<K extends Canonical>(
	...params:
		| [token: ReadableToken<any, any, any>]
		| [family: ReadableFamilyToken<any, K, any>, key: NoInfer<K>]
): boolean {
	return stateExistsInStore(IMPLICIT.STORE, ...params)
}

export function stateExistsInStore(
	store: RootStore,
	token: ReadableToken<any, any, any>,
): boolean
export function stateExistsInStore<K extends Canonical>(
	store: RootStore,
	family: ReadableFamilyToken<any, K, any>,
	key: NoInfer<K>,
): boolean
export function stateExistsInStore<K extends Canonical>(
	store: RootStore,
	...params:
		| [token: ReadableToken<any, any, any>]
		| [family: ReadableFamilyToken<any, K, any>, key: NoInfer<K>]
): boolean
export function stateExistsInStore<K extends Canonical>(
	store: RootStore,
	...params:
		| [token: ReadableToken<any, any, any>]
		| [family: ReadableFamilyToken<any, K, any>, key: NoInfer<K>]
): boolean {
	if (params.length === 2) {
		const [family, key] = params
		return seekInStore(store, family, key) !== undefined
	}
	const [token] = params
	try {
		withdraw(store, token)
		return true
	} catch {
		return false
	}
}
