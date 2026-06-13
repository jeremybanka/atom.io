import type { WritableFamilyToken, WritableToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"

import type { Store } from "../store/index.ts"
import { setIntoStore } from "./set-into-store.ts"

export const RESET_STATE: unique symbol = Symbol(`RESET`)

export function resetInStore(
	store: Store,
	token: WritableToken<any, any, any>,
): void

export function resetInStore<K extends Canonical>(
	store: Store,
	token: WritableFamilyToken<any, K, any>,
	key: NoInfer<K>,
): void

export function resetInStore<T, K extends Canonical>(
	store: Store,
	...params:
		| [token: WritableFamilyToken<T, K, any>, key: NoInfer<K>]
		| [token: WritableToken<T, any, any>]
): void

export function resetInStore<T, K extends Canonical>(
	store: Store,
	...params:
		| [token: WritableFamilyToken<T, K, any>, key: NoInfer<K>]
		| [token: WritableToken<T, any, any>]
): void {
	const subParams = [...params, RESET_STATE] as const
	setIntoStore(store, ...subParams)
}
