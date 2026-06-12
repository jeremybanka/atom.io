import {
	type InferClientErrors,
	type InferClientOutputs,
	ORPCError,
} from "@orpc/client"
import { atom, type Loadable } from "atom.io"

import { client } from "./client.ts"

type Profile = InferClientOutputs<typeof client>[`users`][`profile`]
type ProfileError = InferClientErrors<typeof client>[`users`][`profile`]

const profileAtom = atom<Loadable<Profile>, ProfileError | Error>({
	key: `profile`,
	default: () => client.users.profile(),
	catch: [ORPCError, Error],
})
