import type { ReadableToken, ViewOf } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { stringifyJson } from "atom.io/foundations/json"

import type { ReadableFamily } from "../state-types.ts"
import type { Store } from "../store/index.ts"

export function getFallback<T, K extends Canonical, E>(
	store: Store,
	token: ReadableToken<T, K, E>,
	family: ReadableFamily<T, K, E>,
	subKey: NoInfer<K>,
): ViewOf<E | T> {
	const disposal = store.disposalTraces.buffer.find(
		(item) => item?.key === stringifyJson(subKey),
	)
	store.logger.error(
		`❌`,
		token.type,
		token.key,
		`gets a fallback value because key`,
		subKey,
		`is not allocated`,
		disposal
			? `This key was previously disposed:\n${disposal.trace}`
			: `(no previous disposal trace found)`,
	)
	switch (family.type) {
		case `mutable_atom_family`: {
			if (store.defaults.has(family.key)) {
				return store.defaults.get(family.key)
			}
			const defaultValue = new family.class()
			store.defaults.set(family.key, defaultValue)
			return defaultValue.READONLY_VIEW
		}
		case `atom_family`: {
			if (store.defaults.has(family.key)) {
				return store.defaults.get(family.key)
			}
			const def = family.default as (key: K) => T
			const defaultValue = def(subKey)
			store.defaults.set(family.key, defaultValue)
			return defaultValue as ViewOf<T>
		}
		case `readonly_pure_selector_family`:
		case `writable_pure_selector_family`:
		case `readonly_held_selector_family`:
		case `writable_held_selector_family`: {
			if (store.defaults.has(family.key)) {
				return store.defaults.get(family.key)
			}
			const defaultValue = family.default(subKey)
			store.defaults.set(family.key, defaultValue)
			return defaultValue as ViewOf<T>
		}
	}
}
