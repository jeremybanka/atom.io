import type {
	FamilyMetadata,
	MutableAtomFamilyOptions,
	MutableAtomFamilyToken,
	MutableAtomOptions,
	MutableAtomToken,
	StateLifecycleEvent,
} from "atom.io"
import { PRETTY_ENTITY_NAMES } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { stringifyJson } from "atom.io/foundations/json"
import { Subject } from "atom.io/foundations/subject"

import { createWritablePureSelectorFamily } from "../families/index.ts"
import { newest } from "../lineage.ts"
import { createMutableAtom } from "../mutable/index.ts"
import type { MutableAtomFamily } from "../state-types.ts"
import type { RootStore } from "../transaction/index.ts"
import { FamilyTracker } from "./tracker-family.ts"
import type { AsJSON, Transceiver } from "./transceiver.ts"

export function createMutableAtomFamily<
	T extends Transceiver<any, any, any>,
	K extends Canonical,
>(
	store: RootStore,
	options: MutableAtomFamilyOptions<T, K>,
	internalRoles?: string[],
): MutableAtomFamilyToken<T, K> {
	const familyToken: MutableAtomFamilyToken<T & Transceiver<any, any, any>, K> =
		{
			key: options.key,
			type: `mutable_atom_family`,
		}

	const existing = store.families.get(options.key)
	if (existing && store.config.isProduction === true) {
		store.logger.error(
			`❗`,
			`mutable_atom_family`,
			options.key,
			`Overwriting an existing ${PRETTY_ENTITY_NAMES[existing.type]} "${existing.key}" in store "${store.config.name}". You can safely ignore this warning if it is due to hot module replacement.`,
		)
	}

	const subject = new Subject<StateLifecycleEvent<MutableAtomToken<T>>>()

	const create = (key: K): MutableAtomToken<T> => {
		const subKey = stringifyJson(key)
		const family: FamilyMetadata = { key: options.key, subKey }
		const fullKey = `${options.key}(${subKey})`
		const target = newest(store)

		const individualOptions: MutableAtomOptions<T> = {
			key: fullKey,
			class: options.class,
		}
		if (options.effects) {
			individualOptions.effects = options.effects(key)
		}

		return createMutableAtom(target, individualOptions, family)
	}

	const atomFamily: MutableAtomFamily<T, K> = {
		...familyToken,
		create,
		class: options.class,
		subject,
		install: (s: RootStore) => createMutableAtomFamily(s, options),
		internalRoles,
	}

	store.families.set(options.key, atomFamily)

	createWritablePureSelectorFamily<AsJSON<T>, K, never>(
		store,
		{
			key: `${options.key}:JSON`,
			get:
				(key) =>
				({ get }) =>
					get(familyToken, key).toJSON(),
			set:
				(key) =>
				({ set }, newValue) => {
					set(familyToken, key, options.class.fromJSON(newValue))
				},
		},
		[`mutable`, `json`],
	)

	new FamilyTracker(atomFamily, store)

	return familyToken
}
