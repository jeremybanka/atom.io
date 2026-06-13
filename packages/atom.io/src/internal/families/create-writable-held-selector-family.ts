import type {
	FamilyMetadata,
	StateLifecycleEvent,
	WritableHeldSelectorFamilyOptions,
	WritableHeldSelectorFamilyToken,
	WritableHeldSelectorToken,
} from "atom.io"
import { PRETTY_ENTITY_NAMES } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { stringifyJson } from "atom.io/foundations/json"
import { Subject } from "atom.io/foundations/subject"

import { newest } from "../lineage.ts"
import { createWritableHeldSelector } from "../selector/index.ts"
import type { WritableHeldSelectorFamily } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import type { RootStore } from "../transaction/index.ts"

export function createWritableHeldSelectorFamily<
	T extends object,
	K extends Canonical,
>(
	store: Store,
	options: WritableHeldSelectorFamilyOptions<T, K>,
	internalRoles?: string[],
): WritableHeldSelectorFamilyToken<T, K> {
	const familyKey = options.key
	const type = `writable_held_selector_family`

	const familyToken = {
		key: familyKey,
		type,
	} as const satisfies WritableHeldSelectorFamilyToken<T, K>

	const existing = store.families.get(familyKey)
	if (existing && store.config.isProduction === true) {
		store.logger.error(
			`❗`,
			type,
			familyKey,
			`Overwriting an existing ${PRETTY_ENTITY_NAMES[existing.type]} "${existing.key}" in store "${store.config.name}". You can safely ignore this warning if it is due to hot module replacement.`,
		)
	}
	const subject = new Subject<
		StateLifecycleEvent<WritableHeldSelectorToken<T>>
	>()

	const create = (key: K): WritableHeldSelectorToken<T> => {
		const subKey = stringifyJson(key)
		const family: FamilyMetadata = { key: familyKey, subKey }
		const fullKey = `${familyKey}(${subKey})`
		const target = newest(store)

		return createWritableHeldSelector(
			target,
			{
				key: fullKey,
				const: options.const(key),
				get: options.get(key),
				set: options.set(key),
			},
			family,
		)
	}

	const selectorFamily: WritableHeldSelectorFamily<T, K> = {
		...familyToken,
		create,
		internalRoles,
		subject,
		install: (s: RootStore) => createWritableHeldSelectorFamily(s, options),
		default: options.const,
	}

	store.families.set(familyKey, selectorFamily)
	return familyToken
}
