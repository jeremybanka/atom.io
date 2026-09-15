import type {
	FamilyMetadata,
	ReadonlyHeldSelectorFamilyOptions,
	ReadonlyHeldSelectorFamilyToken,
	ReadonlyHeldSelectorToken,
} from "atom.io"
import { PRETTY_ENTITY_NAMES } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"

import { newest } from "../lineage.ts"
import { createReadonlyHeldSelector } from "../selector/index.ts"
import type { ReadonlyHeldSelectorFamily } from "../state-types.ts"
import type { RootStore } from "../transaction/index.ts"
import {
	type PreparedFamilyKey,
	prepareFamilyKey,
} from "./prepare-family-key.ts"

export function createReadonlyHeldSelectorFamily<
	T extends object,
	K extends Canonical,
>(
	store: RootStore,
	options: ReadonlyHeldSelectorFamilyOptions<T, K>,
	internalRoles?: string[],
): ReadonlyHeldSelectorFamilyToken<T, K> {
	const familyKey = options.key
	const type = `readonly_held_selector_family`

	const familyToken = {
		key: familyKey,
		type,
	} as const satisfies ReadonlyHeldSelectorFamilyToken<T, K>

	const existing = store.families.get(familyKey)
	if (existing && store.config.isProduction === true) {
		store.logger.error(
			`❗`,
			type,
			familyKey,
			`Overwriting an existing ${PRETTY_ENTITY_NAMES[existing.type]} "${existing.key}" in store "${store.config.name}". You can safely ignore this warning if it is due to hot module replacement.`,
		)
	}

	const create = (
		key: K,
		prepared?: PreparedFamilyKey<K>,
	): ReadonlyHeldSelectorToken<T> => {
		const { subKey, fullKey } = prepared ?? prepareFamilyKey(familyKey, key)
		const family: FamilyMetadata = { key: familyKey, subKey }
		const target = newest(store)

		return createReadonlyHeldSelector(
			target,
			{
				key: fullKey,
				const: options.const(key),
				get: options.get(key),
			},
			family,
		)
	}

	const readonlySelectorFamily: ReadonlyHeldSelectorFamily<T, K> = {
		...familyToken,
		create,
		internalRoles,
		install: (s: RootStore) => createReadonlyHeldSelectorFamily(s, options),
		default: options.const,
	}

	store.families.set(familyKey, readonlySelectorFamily)
	return familyToken
}
