import { atom } from "atom.io"
import { z } from "zod"

export const sharedCountAtom = atom<number>({
	default: 0,
	key: `sharedCount`,
})

// The server validates every value received from a pushing client.
export const sharedCountSchema = z.number().int().nonnegative()
