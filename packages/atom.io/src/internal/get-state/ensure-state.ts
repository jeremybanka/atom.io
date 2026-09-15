import type {
	AtomCreationEvent,
	ReadableFamilyToken,
	ReadableToken,
} from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { parseJson } from "atom.io/foundations/json"
import type { Subject } from "atom.io/foundations/subject"

import {
	encodeFamilyKey,
	getFamilyOfToken,
	prepareFamilyKey,
	seekEncodedInStore,
} from "../families/index.ts"
import { mintInStore, MUST_CREATE } from "../families/mint-in-store.ts"
import { newest } from "../lineage.ts"
import type { ReadableFamily } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import { withdraw } from "../store/index.ts"
import { isChildStore, isRootStore } from "../transaction/index.ts"

export function ensureState<T, K extends Canonical, E>(
	store: Store,
	...params:
		| [token: ReadableFamilyToken<T, K, E>, key: NoInfer<K>]
		| [token: ReadableToken<T, K, E>]
): {
	token: ReadableToken<T, K, E>
	family: ReadableFamily<T, K, E> | undefined
	subKey: NoInfer<K> | undefined
} {
	let existingToken: ReadableToken<T, K, E> | undefined
	let brandNewToken: ReadableToken<T, K, E> | undefined
	let family: ReadableFamily<T, K, E> | undefined
	let subKey: K | undefined
	let token: ReadableToken<T, K, E>
	if (params.length === 1) {
		token = params[0]
		if (`family` in token) {
			const familyToken = getFamilyOfToken(store, token)
			family = withdraw(store, familyToken) as ReadableFamily<T, K, E>
			const encoded = encodeFamilyKey<K>(familyToken.key, token.family.subKey)
			existingToken = seekEncodedInStore(store, familyToken, encoded)
			if (`counterfeit` in token) {
				subKey = parseJson(token.family.subKey)
				return {
					token,
					family,
					subKey,
				}
			}
			if (!existingToken) {
				subKey = parseJson(token.family.subKey)
				brandNewToken = mintInStore(MUST_CREATE, store, familyToken, subKey, {
					...encoded,
					key: subKey,
				})
				token = brandNewToken
			} else {
				token = existingToken
			}
		}
	} else {
		family = withdraw(store, params[0])
		subKey = params[1]
		const prepared = prepareFamilyKey(family.key, subKey)
		existingToken = seekEncodedInStore(store, family, prepared)
		if (!existingToken) {
			brandNewToken = mintInStore(MUST_CREATE, store, family, subKey, prepared)
			token = brandNewToken
		} else {
			token = existingToken
		}
	}

	const isCounterfeit = `counterfeit` in token
	const isNewlyCreated = Boolean(brandNewToken) && isCounterfeit === false
	if (isNewlyCreated && family) {
		let subType: `readable` | `writable`
		switch (token.type) {
			case `readonly_pure_selector`:
			case `readonly_held_selector`:
				subType = `readable`
				break
			case `atom`:
			case `mutable_atom`:
			case `writable_pure_selector`:
			case `writable_held_selector`:
				subType = `writable`
				break
		}
		const atomCreationEvent: AtomCreationEvent<any> = {
			type: `atom_creation`,
			token,
			timestamp: Date.now(),
		}
		if (`subject` in family) {
			const familySubject = family.subject as Subject<AtomCreationEvent<any>>
			familySubject.next(atomCreationEvent)
		}
		const target = newest(store)
		if (token.family) {
			if (isRootStore(target)) {
				switch (token.type) {
					case `atom`:
					case `mutable_atom`:
						store.on.atomCreation.next(token)
						break
					case `writable_pure_selector`:
					case `readonly_pure_selector`:
					case `writable_held_selector`:
					case `readonly_held_selector`:
						store.on.selectorCreation.next(token)
						break
				}
			} else if (
				`subject` in family &&
				isChildStore(target) &&
				target.on.transactionApplying.state === null
			) {
				target.transactionMeta.update.subEvents.push(atomCreationEvent)
			}
		}
	}

	return {
		token,
		family,
		subKey,
	}
}
