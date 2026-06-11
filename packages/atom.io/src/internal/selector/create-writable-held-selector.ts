import type {
	FamilyMetadata,
	Read,
	Write,
	WritableHeldSelectorOptions,
	WritableHeldSelectorToken,
} from "atom.io"
import type { Canonical } from "atom.io/json"

import { writeToCache } from "../caching"
import { newest } from "../lineage"
import type { WritableHeldSelector } from "../state-types"
import type { Store } from "../store"
import { Subject } from "../subject"
import type { RootStore } from "../transaction"
import { registerSelector } from "./register-selector"

type WritableHeldSelectorFamilyMemberOptions<
	T extends object,
	K extends Canonical,
> = Omit<WritableHeldSelectorOptions<T>, `get` | `set`> & {
	familyKey: K
	get: Read<(key: K, permanent: T) => void>
	set: Write<(key: K, newValue: T) => void>
}

export function createWritableHeldSelector<
	T extends object,
	K extends Canonical = any,
>(
	store: Store,
	options:
		| WritableHeldSelectorFamilyMemberOptions<T, K>
		| WritableHeldSelectorOptions<T>,
	family: FamilyMetadata<K> | undefined,
): WritableHeldSelectorToken<T, K> {
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
		if (`familyKey` in options) {
			options.get(getterToolkit, options.familyKey, constant)
		} else {
			options.get(getterToolkit, constant)
		}
		writeToCache(innerTarget, mySelector, constant)
		store.logger.info(`✨`, type, key, `=`, constant)
		covered.clear()
		return constant
	}

	const setSelf = (): void => {
		if (`familyKey` in options) {
			options.set(setterToolkit, options.familyKey, constant)
		} else {
			options.set(setterToolkit, constant)
		}
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
