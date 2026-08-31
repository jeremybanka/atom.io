import type {
	MutableAtomToken,
	WritablePureSelectorFamilyToken,
	WritablePureSelectorToken,
} from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"

import { encodeFamilyKey, seekEncodedInStore } from "../families/index.ts"
import { mintEncodedInStore } from "../families/mint-in-store.ts"
import { newest } from "../lineage.ts"
import { type Store, withdraw } from "../store/index.ts"
import type { AsJSON, Transceiver } from "./transceiver.ts"

export const getJsonTokenFromStore = <
	T extends Transceiver<any, any, any>,
	K extends Canonical,
>(
	store: Store,
	mutableAtomToken: MutableAtomToken<T, K>,
): WritablePureSelectorToken<AsJSON<T>, K> => {
	if (mutableAtomToken.family) {
		const target = newest(store)
		const jsonFamilyKey = `${mutableAtomToken.family.key}:JSON`
		const jsonFamilyToken: WritablePureSelectorFamilyToken<AsJSON<T>, K> = {
			key: jsonFamilyKey,
			type: `writable_pure_selector_family`,
		}
		const family = withdraw(target, jsonFamilyToken)
		const encoded = encodeFamilyKey<K>(
			jsonFamilyKey,
			mutableAtomToken.family.subKey,
		)
		const existing = seekEncodedInStore(store, family, encoded)
		if (existing) {
			return existing as WritablePureSelectorToken<AsJSON<T>, K>
		}
		return mintEncodedInStore(
			store,
			family,
			encoded,
		) as WritablePureSelectorToken<AsJSON<T>, K>
	}
	const token: WritablePureSelectorToken<AsJSON<T>, K> = {
		type: `writable_pure_selector`,
		key: `${mutableAtomToken.key}:JSON`,
	}
	return token
}
