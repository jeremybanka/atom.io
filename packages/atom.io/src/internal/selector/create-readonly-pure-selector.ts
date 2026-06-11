import type {
	FamilyMetadata,
	Read,
	ReadonlyPureSelectorOptions,
	ReadonlyPureSelectorToken,
	StateUpdate,
} from "atom.io"
import type { Canonical } from "atom.io/json"

import { newest } from "../lineage"
import type { ReadonlyPureSelector } from "../state-types"
import type { Store } from "../store"
import { Subject } from "../subject"
import type { RootStore } from "../transaction"
import { registerSelector } from "./register-selector"

type ReadonlyPureSelectorFamilyMemberOptions<
	T,
	K extends Canonical,
	E,
> = Omit<ReadonlyPureSelectorOptions<T, E>, `get`> & {
	familyKey: K
	get: Read<(key: K) => T>
}

export function createReadonlyPureSelector<T, K extends Canonical, E>(
	store: Store,
	options:
		| ReadonlyPureSelectorFamilyMemberOptions<T, K, E>
		| ReadonlyPureSelectorOptions<T, E>,
	family: FamilyMetadata<K> | undefined,
): ReadonlyPureSelectorToken<T, K, E> {
	const target = newest(store)
	const subject = new Subject<StateUpdate<E | T>>()
	const covered = new Set<string>()
	const key = options.key
	const type = `readonly_pure_selector` as const
	store.logger.info(`🔨`, type, key, `is being created`)

	const { get, find, json, relations } = registerSelector(
		target,
		type,
		key,
		covered,
	)

	const getFrom = () => {
		const innerTarget = newest(store)
		const upstreamStates = innerTarget.selectorGraph.getRelationEntries({
			downstreamSelectorKey: key,
		})
		for (const [downstreamSelectorKey, { source }] of upstreamStates) {
			if (source !== key) {
				innerTarget.selectorGraph.delete(downstreamSelectorKey, key)
			}
		}
		innerTarget.selectorAtoms.delete(key)
		const toolkit = { get, find, json, relations }
		const value =
			`familyKey` in options
				? options.get(toolkit, options.familyKey)
				: options.get(toolkit)
		store.logger.info(`✨`, type, key, `=`, value)
		covered.clear()
		return value
	}

	const readonlySelector: ReadonlyPureSelector<T, E> = {
		...options,
		type,
		subject,
		getFrom,
		install: (s: RootStore) => createReadonlyPureSelector(s, options, family),
	}
	if (family) readonlySelector.family = family

	target.readonlySelectors.set(key, readonlySelector)

	const token: ReadonlyPureSelectorToken<T> = { key, type }
	if (family) token.family = family

	return token
}
