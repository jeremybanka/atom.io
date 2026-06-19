import type {
	AtomLifecycleEvent,
	FamilyMetadata,
	RegularAtomFamilyOptions,
	RegularAtomFamilyToken,
	RegularAtomOptions,
	RegularAtomToken,
} from "atom.io"
import { PRETTY_ENTITY_NAMES } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { stringifyJson } from "atom.io/foundations/json"
import { Subject } from "atom.io/foundations/subject"

import { createRegularAtom } from "../atom/index.ts"
import { isFn } from "../is-fn.ts"
import { newest } from "../lineage.ts"
import type { RegularAtomFamily } from "../state-types.ts"
import type { RootStore } from "../transaction/index.ts"

export function createRegularAtomFamily<T, K extends Canonical, E>(
	store: RootStore,
	options: RegularAtomFamilyOptions<T, K, E>,
	internalRoles?: string[],
): RegularAtomFamilyToken<T, K, E> {
	const familyToken: RegularAtomFamilyToken<T, K, E> = {
		key: options.key,
		type: `atom_family`,
	}

	const existing = store.families.get(options.key)
	if (existing && store.config.isProduction === true) {
		store.logger.error(
			`❗`,
			`atom_family`,
			options.key,
			`Overwriting an existing ${PRETTY_ENTITY_NAMES[existing.type]} "${existing.key}" in store "${store.config.name}". You can safely ignore this warning if it is due to hot module replacement.`,
		)
	}

	const subject = new Subject<AtomLifecycleEvent<RegularAtomToken<T, K, E>>>()

	const create = <Key extends K>(key: Key): RegularAtomToken<T, Key, E> => {
		const subKey = stringifyJson(key)
		const family: FamilyMetadata<Key> = { key: options.key, subKey }
		const fullKey = `${options.key}(${subKey})`
		const target = newest(store)

		const def = options.default
		const individualOptions: RegularAtomOptions<T, E> = {
			key: fullKey,
			default: isFn(def) ? () => def(key) : def,
		}
		if (options.effects) {
			individualOptions.effects = options.effects(key)
		}
		if (options.catch) {
			individualOptions.catch = options.catch
		}

		return createRegularAtom(target, individualOptions, family)
	}

	const atomFamily: RegularAtomFamily<T, K, E> = {
		...familyToken,
		create,
		default: options.default,
		subject,
		install: (s: RootStore) => createRegularAtomFamily(s, options),
		internalRoles,
	}

	store.families.set(options.key, atomFamily)
	if (isFn(options.default) === false) {
		store.defaults.set(options.key, options.default)
	}
	return familyToken
}
