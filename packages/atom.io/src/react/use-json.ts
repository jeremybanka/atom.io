import type { MutableAtomFamilyToken, MutableAtomToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import type { Json } from "atom.io/foundations/json"
import type { AsJSON, Transceiver } from "atom.io/internal"
import { findInStore, getJsonTokenFromStore } from "atom.io/internal"
import { useContext } from "react"

import { StoreContext } from "./store-context.tsx"
import { useO } from "./use-o.ts"

export function useJSON<T extends Transceiver<any, any, any>>(
	token: MutableAtomToken<T>,
): AsJSON<T>

export function useJSON<
	T extends Transceiver<any, any, any>,
	K extends Canonical,
>(token: MutableAtomFamilyToken<T, K>, key: NoInfer<K>): AsJSON<T>

export function useJSON(
	token: MutableAtomFamilyToken<any, any> | MutableAtomToken<any>,
	key?: Canonical,
): Json.Serializable {
	const store = useContext(StoreContext)
	const stateToken: MutableAtomToken<any> =
		token.type === `mutable_atom_family` ? findInStore(store, token, key) : token
	const jsonToken = getJsonTokenFromStore(store, stateToken)
	return useO(jsonToken)
}
