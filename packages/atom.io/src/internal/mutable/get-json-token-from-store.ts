import type {
	MutableAtomToken,
	WritablePureSelectorFamilyToken,
	WritablePureSelectorToken,
} from "atom.io"
import { parseJson } from "atom.io/json"

import { findInStore } from "../families/index.ts"
import { newest } from "../lineage.ts"
import { type Store, withdraw } from "../store/index.ts"
import type { AsJSON, Transceiver } from "./transceiver.ts"

export const getJsonTokenFromStore = <T extends Transceiver<any, any, any>>(
	store: Store,
	mutableAtomToken: MutableAtomToken<T>,
): WritablePureSelectorToken<AsJSON<T>> => {
	if (mutableAtomToken.family) {
		const target = newest(store)
		const jsonFamilyKey = `${mutableAtomToken.family.key}:JSON`
		const jsonFamilyToken: WritablePureSelectorFamilyToken<AsJSON<T>, string> = {
			key: jsonFamilyKey,
			type: `writable_pure_selector_family`,
		}
		const family = withdraw(target, jsonFamilyToken)
		const subKey = parseJson(mutableAtomToken.family.subKey)
		const jsonToken = findInStore(store, family, subKey)
		return jsonToken
	}
	const token: WritablePureSelectorToken<AsJSON<T>> = {
		type: `writable_pure_selector`,
		key: `${mutableAtomToken.key}:JSON`,
	}
	return token
}
