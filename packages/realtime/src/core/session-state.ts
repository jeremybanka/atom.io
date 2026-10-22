import { atom, type RegularAtomToken } from "atom.io"

import type { SocketKey, UserKey } from "./realtime-key-types.ts"

export const mySocketKeyAtom: RegularAtomToken<SocketKey | undefined> = atom({
	key: `mySocketKey`,
	default: undefined,
})

export const myUserKeyAtom: RegularAtomToken<UserKey | null> = atom({
	key: `myUserKey`,
	default: null,
	effects: [
		async (userKey) => {
			if (typeof window !== `undefined`) {
				const { storageSync } = await import(`atom.io/web`)
				await storageSync(globalThis.localStorage, JSON, `myUserKey`)(userKey)
			}
		},
	],
})
