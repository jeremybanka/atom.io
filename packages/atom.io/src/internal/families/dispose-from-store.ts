import type { ReadableFamilyToken, ReadableToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"

import { disposeAtom } from "../atom/index.ts"
import { disposeSelector } from "../selector/index.ts"
import { type Store, withdraw } from "../store/index.ts"
import { findInStore } from "./find-in-store.ts"

export function disposeFromStore(
	store: Store,
	token: ReadableToken<any, any, any>,
): void

export function disposeFromStore<K extends Canonical>(
	store: Store,
	token: ReadableFamilyToken<any, K, any>,
	key: NoInfer<K>,
): void

export function disposeFromStore<K extends Canonical>(
	store: Store,
	...params:
		| [token: ReadableFamilyToken<any, K, any>, key: NoInfer<K>]
		| [token: ReadableToken<any, any, any>]
): void

export function disposeFromStore(
	store: Store,
	...params:
		| [token: ReadableFamilyToken<any, any, any>, key: Canonical]
		| [token: ReadableToken<any, any, any>]
): void {
	let token: ReadableToken<any, any, any>
	if (params.length === 1) {
		token = params[0]
	} else {
		const family = params[0]
		const key = params[1]
		const maybeToken = findInStore(store, family, key)
		token = maybeToken
	}
	try {
		withdraw(store, token)
	} catch (_) {
		store.logger.error(
			`❌`,
			token.type,
			token.key,
			`could not be disposed because it was not found in the store "${store.config.name}".`,
		)
		return
	}
	switch (token.type) {
		case `atom`:
		case `mutable_atom`:
			disposeAtom(store, token)
			break
		case `writable_pure_selector`:
		case `readonly_pure_selector`:
		case `writable_held_selector`:
		case `readonly_held_selector`:
			disposeSelector(store, token)
			break
	}
}
