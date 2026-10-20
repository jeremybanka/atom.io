import { StoreProvider, useI, useO } from "@atom.io/solid"
import { atom } from "atom.io"

const countAtom = atom<number>({ key: `count`, default: 0 })
const read: () => number = useO(countAtom)
const write = useI(countAtom)
write(read() + 1)
// @ts-expect-error The setter must reject a wrong value type.
write(`wrong`)
StoreProvider({ children: undefined })

type IsAny<T> = 0 extends 1 & T ? true : false
const typed: [IsAny<typeof StoreProvider>, IsAny<typeof useO>] = [false, false]
void typed
