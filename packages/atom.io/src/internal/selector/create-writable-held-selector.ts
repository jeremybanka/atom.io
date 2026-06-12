import type {
	FamilyMetadata,
	WritableHeldSelectorOptions,
	WritableHeldSelectorToken,
} from "atom.io"

import { writeToCache } from "../caching.ts"
import { newest } from "../lineage.ts"
import type { WritableHeldSelector } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import { Subject } from "../subject.ts"
import type { RootStore } from "../transaction/index.ts"
import { registerSelector } from "./register-selector.ts"

export function createWritableHeldSelector<T extends object>(
	store: Store,
	options: WritableHeldSelectorOptions<T>,
	family: FamilyMetadata | undefined,
): WritableHeldSelectorToken<T> {
	const target = newest(store)
	const subject = new Subject<{ newValue: T; oldValue: T }>()
	const covered = new Set<string>()
	const { key, const: constant } = options
	const type = `writable_held_selector` as const
	store.logger.info(`🔨`, type, key, `is being created`)

	const setterToolkit = registerSelector(target, type, key, covered)
	const { find, get, json, relations } = setterToolkit
	const getterToolkit = { find, get, json, relations }

	const getFrom = (innerTarget: Store): T => {
		const upstreamStates = innerTarget.selectorGraph.getRelationEntries({
			downstreamSelectorKey: key,
		})
		for (const [downstreamSelectorKey, { source }] of upstreamStates) {
			if (source !== key) {
				innerTarget.selectorGraph.delete(downstreamSelectorKey, key)
			}
		}
		innerTarget.selectorAtoms.delete(key)
		options.get(getterToolkit, constant)
		writeToCache(innerTarget, mySelector, constant)
		store.logger.info(`✨`, type, key, `=`, constant)
		covered.clear()
		return constant
	}

	const setSelf = (): void => {
		options.set(setterToolkit, constant)
	}

	const mySelector: WritableHeldSelector<T> = {
		...options,
		type,
		subject,
		getFrom,
		setSelf,
		install: (s: RootStore) => createWritableHeldSelector(s, options, family),
	}
	if (family) mySelector.family = family

	target.writableSelectors.set(key, mySelector)

	const token: WritableHeldSelectorToken<T> = { key, type }
	if (family) token.family = family

	return token
}
