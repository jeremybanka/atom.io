import "@atom.io/hydrogen-devtools/css"

import type { VNode } from "@atom.io/hydrogen"
import { AtomIODevtools } from "@atom.io/hydrogen-devtools"
import type { RootStore } from "atom.io/internal"

export function Debugger(props: { store: RootStore }): VNode {
	return <AtomIODevtools store={props.store} hideByDefault />
}
