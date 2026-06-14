import type { MutableAtomFamilyToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import type { Json } from "atom.io/foundations/json"

import { newest } from "../lineage.ts"
import type { WritablePureSelectorFamily } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import type { Transceiver } from "./transceiver.ts"

export function getJsonFamily<
	Core extends Transceiver<any, Json.Serializable, Json.Serializable>,
	Key extends Canonical,
>(
	mutableAtomFamily: MutableAtomFamilyToken<Core, Key>,
	store: Store,
): WritablePureSelectorFamily<ReturnType<Core[`toJSON`]>, Key, never> {
	const target = newest(store)
	const key = `${mutableAtomFamily.key}:JSON`
	const jsonFamily = target.families.get(key) as WritablePureSelectorFamily<
		ReturnType<Core[`toJSON`]>,
		Key,
		never
	>
	return jsonFamily
}
