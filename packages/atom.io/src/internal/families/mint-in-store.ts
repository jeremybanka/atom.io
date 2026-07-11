import type { ReadableToken, WritableToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"

import type { ReadableFamily } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import {
	type EncodedFamilyKey,
	type PreparedFamilyKey,
	prepareFamilyKey,
} from "./prepare-family-key.ts"

export const FAMILY_MEMBER_TOKEN_TYPES = {
	atom_family: `atom`,
	molecule_family: `molecule`,
	mutable_atom_family: `mutable_atom`,
	readonly_held_selector_family: `readonly_held_selector`,
	readonly_pure_selector_family: `readonly_pure_selector`,
	writable_held_selector_family: `writable_held_selector`,
	writable_pure_selector_family: `writable_pure_selector`,
} as const

export const MUST_CREATE: unique symbol = Symbol(`MUST_CREATE`)
export const DO_NOT_CREATE: unique symbol = Symbol(`DO_NOT_CREATE`)

export function mintEncodedInStore<T, K extends Canonical, Key extends K, E>(
	store: Store,
	family: ReadableFamily<T, K, E>,
	encoded: EncodedFamilyKey<Key>,
): ReadableToken<T, Key, E> {
	const { type: familyType, key: familyKey } = family
	const counterfeit =
		!store.molecules.has(encoded.subKey) && store.config.lifespan === `immortal`
	if (counterfeit) {
		store.logger.warn(
			`💣`,
			`key`,
			encoded.subKey,
			`was used to mint a counterfeit token for`,
			familyType,
			`"${familyKey}"`,
		)
	}
	const token: ReadableToken<T, Key, E> & { counterfeit?: true } = {
		key: encoded.fullKey,
		type: FAMILY_MEMBER_TOKEN_TYPES[familyType],
		family: {
			key: familyKey,
			subKey: encoded.subKey,
		},
	}
	if (counterfeit) {
		token.counterfeit = true
	}
	return token
}

export function mintInStore<T, K extends Canonical, KK extends K, E>(
	mustCreate: typeof DO_NOT_CREATE | typeof MUST_CREATE,
	store: Store,
	family: ReadableFamily<T, K, E>,
	key: KK,
	prepared?: PreparedFamilyKey<KK>,
): WritableToken<T, KK, E>
export function mintInStore<T, K extends Canonical, KK extends K, E>(
	mustCreate: typeof DO_NOT_CREATE | typeof MUST_CREATE,
	store: Store,
	family: ReadableFamily<T, K, E>,
	key: KK,
	prepared?: PreparedFamilyKey<KK>,
): ReadableToken<T, KK, E>
export function mintInStore<T, K extends Canonical, KK extends K, E>(
	mustCreate: typeof DO_NOT_CREATE | typeof MUST_CREATE,
	store: Store,
	family: ReadableFamily<T, K, E>,
	key: KK,
	prepared?: PreparedFamilyKey<KK>,
): ReadableToken<T, KK, E> {
	const preparedKey = prepared ?? prepareFamilyKey(family.key, key)
	const { subKey: stringKey } = preparedKey
	if (mustCreate === DO_NOT_CREATE) {
		return mintEncodedInStore(store, family, preparedKey)
	}

	const molecule = store.molecules.get(stringKey)
	if (!molecule && store.config.lifespan === `immortal`) {
		return mintEncodedInStore(store, family, preparedKey)
	}
	store.logger.info(
		`👪`,
		family.type,
		family.key,
		`adds member`,
		typeof key === `string` ? `\`${key}\`` : key,
	)
	const token = family.create(key, preparedKey)
	if (molecule) {
		store.moleculeData.set(stringKey, family.key)
	}
	return token
}
