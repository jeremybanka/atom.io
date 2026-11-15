import type { Socket } from "@atom.io/realtime"
import { pullMutableAtom } from "@atom.io/realtime/client"
import type { MutableAtomToken } from "atom.io"
import type { Store } from "atom.io/internal"
import { UList } from "atom.io/transceivers/u-list"
import { z } from "zod"

declare const store: Store
declare const socket: Socket
declare const numbersAtom: MutableAtomToken<UList<number>>

const updateSchema = z.union([
	z.object({ type: z.enum([`add`, `delete`]), value: z.number() }),
	z.object({ type: z.literal(`clear`), values: z.array(z.number()) }),
])
const snapshotSchema = z.array(z.number())
const signalSchema = z.string().refine((value) => {
	try {
		return updateSchema.safeParse(UList.unpackUpdate(value)).success
	} catch {
		return false
	}
})

export const stop = pullMutableAtom(store, socket, numbersAtom, {
	snapshotSchema,
	signalSchema,
	onStatus: (status) => {
		console.info(status.status, status.revision)
	},
})
