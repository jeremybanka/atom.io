import { Effect } from "effect"
import { atomFamily, type Loadable } from "atom.io"

import {
	appRuntime,
	ProfileError,
	ProfileService,
	type Profile,
} from "./runtime"

type ProfileKey = `profile::${string}`

export const profileAtoms = atomFamily<
	Loadable<Profile>,
	ProfileKey,
	ProfileError
>({
	key: `profile`,
	default: (key) => {
		const userId = key.slice(`profile::`.length)

		const program = Effect.gen(function* () {
			const profiles = yield* ProfileService
			return yield* profiles.load(userId)
		})

		return appRuntime.runPromise(program)
	},
	catch: [ProfileError],
})
