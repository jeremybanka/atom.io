import type {
	FamilyMetadata,
	Loadable,
	RegularAtomOptions,
	RegularAtomToken,
	UpdateHandler,
} from "atom.io"
import type { Canonical } from "atom.io/json"

import { eldest, newest } from "../lineage.ts"
import { resetInStore, setIntoStore } from "../set-state/index.ts"
import type { RegularAtom } from "../state-types.ts"
import type { Store } from "../store/index.ts"
import { deposit } from "../store/index.ts"
import { Subject } from "../subject.ts"
import { subscribeToState } from "../subscribe/index.ts"
import type { RootStore } from "../transaction/index.ts"
import type { InternalRole } from "./has-role.ts"

export function createRegularAtom<T, K extends Canonical, E>(
	store: Store,
	options: RegularAtomOptions<T, E>,
	family: FamilyMetadata<K> | undefined,
	internalRoles?: InternalRole[],
): RegularAtomToken<T, K, E> {
	const type = `atom`
	const { key } = options
	store.logger.info(`🔨`, type, key, `is being created`)

	const target = newest(store)
	const existing = target.atoms.get(key)
	if (existing?.type === type && store.config.isProduction === true) {
		store.logger.error(
			`❌`,
			`atom`,
			key,
			`Tried to create atom, but it already exists in the store.`,
		)
		return deposit(existing) as RegularAtomToken<T, K, E>
	}
	const subject = new Subject<{ newValue: T; oldValue: T }>()
	const newAtom: RegularAtom<T, E> = {
		...options,
		type,
		install: (s: RootStore) => {
			s.logger.info(`🛠️`, type, key, `installing in store "${s.config.name}"`)
			return createRegularAtom(s, options, family)
		},
		subject,
	} as const
	if (family) {
		newAtom.family = family
	}
	if (internalRoles) {
		newAtom.internalRoles = internalRoles
	}
	target.atoms.set(key, newAtom)
	const token = deposit(newAtom) as RegularAtomToken<T, K, E>
	if (options.effects) {
		let effectIndex = 0
		const cleanupFunctions: (Promise<(() => void) | void> | (() => void))[] = []
		for (const effect of options.effects) {
			const cleanup = effect({
				resetSelf: () => {
					resetInStore(store, token)
				},
				setSelf: (next) => {
					setIntoStore(store, token, next)
				},
				onSet: (handle: UpdateHandler<T>) =>
					subscribeToState(store, token, `effect[${effectIndex}]`, handle),
				token: token as any,
				store: eldest(store),
			})
			if (cleanup) {
				cleanupFunctions.push(cleanup)
			}
			++effectIndex
		}
		newAtom.cleanup = () => {
			for (const cleanup of cleanupFunctions) {
				if (cleanup instanceof Promise) {
					void cleanup.then((loaded) => loaded?.())
				} else {
					cleanup()
				}
			}
		}
	}
	store.on.atomCreation.next(token)
	return token
}
