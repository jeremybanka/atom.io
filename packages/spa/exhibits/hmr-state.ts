import { atom } from "atom.io"

export const editCountAtom = atom<number>({ key: `editCount`, default: 0 })
