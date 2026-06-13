import type { AsJSON, Transceiver } from "atom.io/internal"
import { findInStore, getJsonTokenFromStore, IMPLICIT } from "atom.io/internal"
import type { Canonical } from "atom.io/json"

import type {
	MutableAtomFamilyToken,
	MutableAtomToken,
	WritablePureSelectorToken,
} from "./tokens.ts"

/**
 * Get the JSON form of a mutable atom as a writable state token.
 * @param token - A {@link MutableAtomToken}
 * @returns A token representing the mutable atom's JSON form
 * @overload Mutable Atom
 */
export function getJsonToken<
	T extends Transceiver<any, any, any>,
	K extends Canonical,
>(token: MutableAtomToken<T, K>): WritablePureSelectorToken<AsJSON<T>, K>

/**
 * Get the JSON form of a mutable atom family member as a writable state token.
 * @param token - A {@link MutableAtomFamilyToken}
 * @param key - The key of the family member
 * @returns A token representing the mutable atom family member's JSON form
 * @overload Mutable Atom Family
 */
export function getJsonToken<
	T extends Transceiver<any, any, any>,
	K extends Canonical,
	Key extends K,
>(
	token: MutableAtomFamilyToken<T, K>,
	key: NoInfer<Key>,
): WritablePureSelectorToken<AsJSON<T>, Key>

export function getJsonToken(
	...params:
		| [token: MutableAtomFamilyToken<any, any>, key: Canonical]
		| [token: MutableAtomToken<any, any>]
): WritablePureSelectorToken<any, any> {
	const token =
		params[0].type === `mutable_atom_family`
			? findInStore(IMPLICIT.STORE, params[0], params[1])
			: params[0]
	return getJsonTokenFromStore(IMPLICIT.STORE, token)
}
