import type {
	AtomFamilyToken,
	AtomToken,
	MutableAtomFamilyToken,
	MutableAtomToken,
	ReadableFamilyToken,
	ReadableToken,
	ReadonlyPureSelectorFamilyToken,
	ReadonlyPureSelectorToken,
	RegularAtomFamilyToken,
	RegularAtomToken,
	SelectorFamilyToken,
	SelectorToken,
	WritableFamilyToken,
	WritablePureSelectorFamilyToken,
	WritablePureSelectorToken,
	WritableToken,
} from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"

import { newest } from "../lineage.ts"
import type { Transceiver } from "../mutable/index.ts"
import type { ReadableState } from "../state-types.ts"
import { deposit, type Store } from "../store/index.ts"
import type { EncodedFamilyKey } from "./prepare-family-key.ts"
import { prepareFamilyKey } from "./prepare-family-key.ts"

export function seekInStore<
	T extends Transceiver<any, any, any>,
	K extends Canonical,
	Key extends K,
>(
	store: Store,
	token: MutableAtomFamilyToken<T, K>,
	key: Key,
): MutableAtomToken<T, Key> | undefined

export function seekInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	token: RegularAtomFamilyToken<T, K, E>,
	key: Key,
): RegularAtomToken<T, Key, E> | undefined

export function seekInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	token: AtomFamilyToken<T, K, E>,
	key: Key,
): AtomToken<T, Key, E> | undefined

export function seekInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	token: WritablePureSelectorFamilyToken<T, K, E>,
	key: Key,
): WritablePureSelectorToken<T, Key, E> | undefined

export function seekInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	token: ReadonlyPureSelectorFamilyToken<T, K, E>,
	key: Key,
): ReadonlyPureSelectorToken<T, Key, E> | undefined

export function seekInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	token: SelectorFamilyToken<T, K, E>,
	key: Key,
): SelectorToken<T, Key, E> | undefined

export function seekInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	token: WritableFamilyToken<T, K, E>,
	key: Key,
): WritableToken<T, Key, E> | undefined

export function seekInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	token: ReadableFamilyToken<T, K, E>,
	key: Key,
): ReadableToken<T, Key, E> | undefined

export function seekInStore(
	store: Store,
	token: ReadableFamilyToken<any, any, any>,
	key: Canonical,
): ReadableToken<any, any, any> | undefined {
	return seekEncodedInStore(store, token, prepareFamilyKey(token.key, key))
}

export function seekEncodedInStore<T, K extends Canonical, E>(
	store: Store,
	token: WritableFamilyToken<T, K, E>,
	encoded: EncodedFamilyKey<K>,
): WritableToken<T, K, E> | undefined
export function seekEncodedInStore<T, K extends Canonical, E>(
	store: Store,
	token: ReadableFamilyToken<T, K, E>,
	encoded: EncodedFamilyKey<K>,
): ReadableToken<T, K, E> | undefined
export function seekEncodedInStore(
	store: Store,
	token: ReadableFamilyToken<any, any, any>,
	encoded: EncodedFamilyKey<any>,
): ReadableToken<any, any, any> | undefined {
	const target = newest(store)
	let state: ReadableState<any, any> | undefined
	switch (token.type) {
		case `atom_family`:
		case `mutable_atom_family`:
			state = target.atoms.get(encoded.fullKey)
			break
		case `writable_held_selector_family`:
		case `writable_pure_selector_family`:
			state = target.writableSelectors.get(encoded.fullKey)
			break
		case `readonly_held_selector_family`:
		case `readonly_pure_selector_family`:
			state = target.readonlySelectors.get(encoded.fullKey)
			break
	}
	if (state) {
		return deposit(state)
	}
	return state
}
