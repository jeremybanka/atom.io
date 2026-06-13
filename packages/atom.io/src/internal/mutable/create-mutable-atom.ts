import type {
	FamilyMetadata,
	MutableAtomOptions,
	MutableAtomToken,
	UpdateHandler,
} from "atom.io"
import { Subject } from "atom.io/foundations/subject"

import { eldest, newest } from "../lineage.ts"
import { createStandaloneSelector } from "../selector/index.ts"
import { resetInStore, setIntoStore } from "../set-state/index.ts"
import type { MutableAtom } from "../state-types.ts"
import { deposit, type Store } from "../store/index.ts"
import { subscribeToState } from "../subscribe/index.ts"
import type { RootStore } from "../transaction/index.ts"
import { Tracker } from "./tracker.ts"
import type { Transceiver } from "./transceiver.ts"

export function createMutableAtom<T extends Transceiver<any, any, any>>(
	store: Store,
	options: MutableAtomOptions<T>,
	family: FamilyMetadata | undefined,
): MutableAtomToken<T> {
	store.logger.info(
		`🔨`,
		`atom`,
		options.key,
		`creating in store "${store.config.name}"`,
	)
	const target = newest(store)
	const { key } = options
	const existing = target.atoms.get(key)
	const type = `mutable_atom`
	if (existing?.type === type && store.config.isProduction === true) {
		store.logger.error(
			`❌`,
			type,
			key,
			`Tried to create atom, but it already exists in the store.`,
		)
		return deposit(existing)
	}
	const subject = new Subject<{
		newValue: T
		oldValue: T
	}>()
	const newAtom: MutableAtom<T> = {
		...options,
		type,
		install: (s: RootStore) => {
			s.logger.info(`🛠️`, `atom`, key, `installing in store "${s.config.name}"`)
			return createMutableAtom(s, options, family)
		},
		subject,
	} as const
	if (family) {
		newAtom.family = family
	}
	target.atoms.set(newAtom.key, newAtom)
	const token = deposit(newAtom)

	new Tracker(token, store)
	if (!family) {
		createStandaloneSelector(store, {
			key: `${key}:JSON`,
			get: ({ get }) => get(token).toJSON(),
			set: ({ set }, newValue) => {
				set(token, options.class.fromJSON(newValue))
			},
		})
	}

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
