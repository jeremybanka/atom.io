import {
	ORPCError,
	type InferClientErrors,
	type InferClientOutputs,
} from "@orpc/client"
import { atom, type Loadable } from "atom.io"

import { client } from "./client"

type Profile = InferClientOutputs<typeof client>["users"]["profile"]
type ProfileError = InferClientErrors<typeof client>["users"]["profile"]

export const profileAtom = atom<Loadable<Profile>, ProfileError>({
	key: "profile",
	default: () => client.users.profile(),
	catch: [ORPCError, Error],
})
