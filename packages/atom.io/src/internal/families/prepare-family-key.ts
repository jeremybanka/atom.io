import type { Canonical } from "atom.io/foundations/canonical"
import { type stringified, stringifyJson } from "atom.io/foundations/json"

export type EncodedFamilyKey<K extends Canonical> = {
	subKey: stringified<K>
	fullKey: string
}

export type PreparedFamilyKey<K extends Canonical> = EncodedFamilyKey<K> & {
	key: K
}

export function encodeFamilyKey<K extends Canonical>(
	familyKey: string,
	subKey: stringified<K>,
): EncodedFamilyKey<K> {
	return {
		subKey,
		fullKey: `${familyKey}(${subKey})`,
	}
}

export function prepareFamilyKey<K extends Canonical>(
	familyKey: string,
	key: K,
): PreparedFamilyKey<K> {
	return {
		key,
		...encodeFamilyKey(familyKey, stringifyJson(key)),
	}
}
