import type {
	FamilyMetadata,
	Read,
	StateUpdate,
	Write,
	WritablePureSelectorOptions,
	WritablePureSelectorToken,
} from "atom.io"
import type { Canonical } from "atom.io/json"

import { newest } from "../lineage"
import type { WritablePureSelector } from "../state-types"
import type { Store } from "../store"
import { Subject } from "../subject"
import type { RootStore } from "../transaction"
import { registerSelector } from "./register-selector"

type WritablePureSelectorFamilyMemberOptions<
	T,
	K extends Canonical,
	E,
> = Omit<WritablePureSelectorOptions<T, E>, `get` | `set`> & {
	familyKey: K
	get: Read<(key: K) => T>
	set: Write<(key: K, newValue: T) => void>
}

export function createWritablePureSelector<T, K extends Canonical, E>(
	store: Store,
	options:
		| WritablePureSelectorFamilyMemberOptions<T, K, E>
		| WritablePureSelectorOptions<T, E>,
	family: FamilyMetadata<K> | undefined,
): WritablePureSelectorToken<T, K, E> {
	const target = newest(store)
	const subject = new Subject<StateUpdate<E | T>>()
	const covered = new Set<string>()
	const key = options.key
	const type = `writable_pure_selector` as const
	store.logger.info(`🔨`, type, key, `is being created`)

	const setterToolkit = registerSelector(target, type, key, covered)
	const { find, get, json, relations } = setterToolkit
	const getterToolkit = { find, get, json, relations }

	const getFrom = (innerTarget: Store): E | T => {
		const upstreamStates = innerTarget.selectorGraph.getRelationEntries({
			downstreamSelectorKey: key,
		})
		for (const [downstreamSelectorKey, { source }] of upstreamStates) {
			if (source !== key) {
				innerTarget.selectorGraph.delete(downstreamSelectorKey, key)
			}
		}
		innerTarget.selectorAtoms.delete(key)
		const value =
			`familyKey` in options
				? options.get(getterToolkit, options.familyKey)
				: options.get(getterToolkit)
		store.logger.info(`✨`, type, key, `=`, value)
		covered.clear()
		return value
	}

	const setSelf = (newValue: T): void => {
		if (`familyKey` in options) {
			options.set(setterToolkit, options.familyKey, newValue)
		} else {
			options.set(setterToolkit, newValue)
		}
	}

	const mySelector: WritablePureSelector<T, E> = {
		...options,
		type,
		subject,
		getFrom,
		setSelf,
		install: (s: RootStore) => createWritablePureSelector(s, options, family),
	}
	if (family) mySelector.family = family

	target.writableSelectors.set(key, mySelector)

	const token: WritablePureSelectorToken<T> = { key, type }
	if (family) token.family = family

	return token
}
