import type {
	FamilyMetadata,
	StateUpdate,
	WritablePureSelectorOptions,
	WritablePureSelectorToken,
} from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { Subject } from "atom.io/foundations/subject"

import { newest } from "../lineage.ts"
import type { WritablePureSelector } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import type { RootStore } from "../transaction/index.ts"
import { registerSelector } from "./register-selector.ts"
import { SelectorDependencyTracker } from "./selector-dependency-tracker.ts"

export function createWritablePureSelector<T, K extends Canonical, E>(
	store: Store,
	options: WritablePureSelectorOptions<T, E>,
	family: FamilyMetadata<K> | undefined,
): WritablePureSelectorToken<T, K, E> {
	const target = newest(store)
	const subject = new Subject<StateUpdate<E | T>>()
	const key = options.key
	const type = `writable_pure_selector` as const
	const dependencies = new SelectorDependencyTracker(key)
	store.logger.info(`🔨`, type, key, `is being created`)

	const setterToolkit = registerSelector(target, type, key, dependencies)
	const { find, get, json, relations } = setterToolkit
	const getterToolkit = { find, get, json, relations }

	const getFrom = (innerTarget: Store): E | T => {
		dependencies.begin()
		try {
			const value = options.get(getterToolkit)
			store.logger.info(`✨`, type, key, `=`, value)
			return value
		} finally {
			dependencies.finish(innerTarget)
		}
	}

	const setSelf = (newValue: T): void => {
		options.set(setterToolkit, newValue)
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
