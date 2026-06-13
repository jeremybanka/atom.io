import type {
	FamilyMetadata,
	ReadonlyHeldSelectorOptions,
	ReadonlyHeldSelectorToken,
} from "atom.io"
import { Subject } from "atom.io/foundations/subject"

import { writeToCache } from "../caching.ts"
import { newest } from "../lineage.ts"
import type { ReadonlyHeldSelector } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import type { RootStore } from "../transaction/index.ts"
import { registerSelector } from "./register-selector.ts"

export function createReadonlyHeldSelector<T extends object>(
	store: Store,
	options: ReadonlyHeldSelectorOptions<T>,
	family: FamilyMetadata | undefined,
): ReadonlyHeldSelectorToken<T> {
	const target = newest(store)
	const subject = new Subject<{ newValue: T; oldValue: T }>()
	const covered = new Set<string>()
	const { key, const: constant } = options
	const type = `readonly_held_selector` as const
	store.logger.info(`🔨`, type, key, `is being created`)

	const { get, find, json, relations } = registerSelector(
		target,
		type,
		key,
		covered,
	)

	const getFrom = (innerTarget: Store) => {
		const upstreamStates = innerTarget.selectorGraph.getRelationEntries({
			downstreamSelectorKey: key,
		})
		for (const [downstreamSelectorKey, { source }] of upstreamStates) {
			if (source !== key) {
				innerTarget.selectorGraph.delete(downstreamSelectorKey, key)
			}
		}
		innerTarget.selectorAtoms.delete(key)
		options.get({ get, find, json, relations }, constant)
		writeToCache(innerTarget, readonlySelector, constant)
		store.logger.info(`✨`, type, key, `=`, constant)
		covered.clear()
		return constant
	}

	const readonlySelector: ReadonlyHeldSelector<T> = {
		...options,
		type,
		subject,
		getFrom,
		install: (s: RootStore) => createReadonlyHeldSelector(s, options, family),
	}
	if (family) readonlySelector.family = family

	target.readonlySelectors.set(key, readonlySelector)
	const token: ReadonlyHeldSelectorToken<T> = { key, type }
	if (family) token.family = family

	return token
}
