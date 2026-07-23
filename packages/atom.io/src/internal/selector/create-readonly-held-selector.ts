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
import { SelectorDependencyTracker } from "./selector-dependency-tracker.ts"

export function createReadonlyHeldSelector<T extends object>(
	store: Store,
	options: ReadonlyHeldSelectorOptions<T>,
	family: FamilyMetadata | undefined,
): ReadonlyHeldSelectorToken<T> {
	const target = newest(store)
	const subject = new Subject<{ newValue: T; oldValue: T }>()
	const { key, const: constant } = options
	const type = `readonly_held_selector` as const
	const dependencies = new SelectorDependencyTracker(key)
	store.logger.info(`🔨`, type, key, `is being created`)

	const { get, find, json, relations } = registerSelector(
		target,
		type,
		key,
		dependencies,
	)

	const getFrom = (innerTarget: Store) => {
		dependencies.begin()
		try {
			options.get({ get, find, json, relations }, constant)
			writeToCache(innerTarget, readonlySelector, constant)
			store.logger.info(`✨`, type, key, `=`, constant)
			return constant
		} finally {
			dependencies.finish(innerTarget)
		}
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
