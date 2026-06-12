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
import type { Canonical } from "atom.io/json"

import type { Transceiver } from "../mutable/index.ts"
import { type Store, withdraw } from "../store/index.ts"
import { DO_NOT_CREATE, mintInStore } from "./mint-in-store.ts"
import { seekInStore } from "./seek-in-store.ts"

// seek [token 🟧] [inits ⬛]
// find [token ✅] [inits ⬛]
// mint [token ✅] [inits 🟧]
// init [token ✅] [inits ✅]

export function findInStore<
	T extends Transceiver<any, any, any>,
	K extends Canonical,
	Key extends K,
>(
	store: Store,
	familyToken: MutableAtomFamilyToken<T, K>,
	key: Key,
): MutableAtomToken<T, Key>

export function findInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	familyToken: RegularAtomFamilyToken<T, K, E>,
	key: Key,
): RegularAtomToken<T, Key, E>

export function findInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	familyToken: AtomFamilyToken<T, K, E>,
	key: Key,
): AtomToken<T, Key, E>

export function findInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	familyToken: WritablePureSelectorFamilyToken<T, K, E>,
	key: Key,
): WritablePureSelectorToken<T, Key, E>

export function findInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	familyToken: ReadonlyPureSelectorFamilyToken<T, K, E>,
	key: Key,
): ReadonlyPureSelectorToken<T, Key, E>

export function findInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	familyToken: SelectorFamilyToken<T, K, E>,
	key: Key,
): SelectorToken<T, Key, E>

export function findInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	familyToken: WritableFamilyToken<T, K, E>,
	key: Key,
): WritableToken<T, Key, E>

export function findInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	familyToken: ReadableFamilyToken<T, K, E>,
	key: Key,
): ReadableToken<T, Key, E>

export function findInStore(
	store: Store,
	familyToken: ReadableFamilyToken<any, any, any>,
	key: Canonical,
): ReadableToken<any, any, any> {
	const family = withdraw(store, familyToken)
	const existingStateToken = seekInStore(store, familyToken, key)
	if (existingStateToken) {
		return existingStateToken
	}
	const newStateToken = mintInStore(DO_NOT_CREATE, store, family, key)
	return newStateToken
}
