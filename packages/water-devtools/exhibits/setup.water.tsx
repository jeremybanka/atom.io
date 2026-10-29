import "@atom.io/water-devtools/css"

import type { VNode } from "@atom.io/water"
import { AtomIODevtools } from "@atom.io/water-devtools"
import type { RootStore } from "atom.io/internal"

export function Debugger(props: { store: RootStore }): VNode {
	return <AtomIODevtools store={props.store} hideByDefault />
}
