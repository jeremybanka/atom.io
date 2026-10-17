import { StoreContext, StoreProvider, useI, useO } from "@atom.io/react"
import { AtomIODevtools } from "@atom.io/react-devtools"
import type { StoreProvider as SolidStoreProvider } from "@atom.io/solid"
import { atom } from "atom.io"
import { createElement, useContext } from "react"

const countAtom = atom<number>({ key: `count`, default: 0 })
function Counter() {
	const store = useContext(StoreContext)
	// @ts-expect-error A missing declaration must not degrade the context to any.
	store.nonexistent
	const count: number = useO(countAtom)
	const update: (value: number) => void = useI(countAtom)
	void update
	return createElement(`span`, null, count)
}
const app = createElement(StoreProvider, null, createElement(Counter))
const devtools = createElement(AtomIODevtools, { hideByDefault: true })
// @ts-expect-error The devtools props retain their declared types.
createElement(AtomIODevtools, { hideByDefault: `yes` })
type IsAny<T> = 0 extends 1 & T ? true : false
const typed: [IsAny<typeof SolidStoreProvider>, IsAny<typeof useO>] = [
	false,
	false,
]
void typed
