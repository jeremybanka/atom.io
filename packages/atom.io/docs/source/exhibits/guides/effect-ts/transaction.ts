import { Effect } from "effect"
import { atom, runTransaction, setState, transaction } from "atom.io"

import {
	appRuntime,
	ProfileError,
	ProfileService,
	type Profile,
} from "./runtime"

const currentProfileAtom = atom<Profile | null>({
	key: `currentProfile`,
	default: null,
})

export const saveProfileErrorAtom = atom<ProfileError | null>({
	key: `saveProfileError`,
	default: null,
})

export const renameProfileTX = transaction({
	key: `renameProfile`,
	do: ({ get, set }, userId: string, nextName: string) => {
		const previous = get(currentProfileAtom)

		if (previous !== null) {
			set(currentProfileAtom, { ...previous, name: nextName })
		}
		set(saveProfileErrorAtom, null)

		const program = Effect.gen(function* () {
			const profiles = yield* ProfileService
			return yield* profiles.rename(userId, nextName)
		})

		void appRuntime.runPromise(program).then(
			(savedProfile) => setState(currentProfileAtom, savedProfile),
			(error: unknown) => {
				if (previous !== null) setState(currentProfileAtom, previous)
				if (error instanceof ProfileError) {
					setState(saveProfileErrorAtom, error)
				}
			},
		)
	},
})

export const renameProfile = runTransaction(renameProfileTX)
