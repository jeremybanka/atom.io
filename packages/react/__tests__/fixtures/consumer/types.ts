import { StoreContext, StoreProvider, useI, useO } from "@atom.io/react"
import { atom } from "atom.io"
import { createElement, useContext } from "react"

const countAtom = atom<number>({ key: `count`, default: 0 })
function Counter() {
	const store = useContext(StoreContext)
	// @ts-expect-error The context must retain its declaration.
	store.nonexistent
	const value: number = useO(countAtom)
	const update = useI(countAtom)
	update(value + 1)
	// @ts-expect-error The setter must reject a wrong value type.
	update(`wrong`)
	return createElement(`span`, null, value)
}
createElement(StoreProvider, null, createElement(Counter))
