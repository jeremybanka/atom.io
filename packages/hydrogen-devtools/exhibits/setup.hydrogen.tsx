import "@atom.io/hydrogen-devtools/css"

import { AtomIODevtools } from "@atom.io/hydrogen-devtools"
import type { RootStore } from "atom.io/internal"
import type { VNode } from "hydrogen"

export function Debugger(props: { store: RootStore }): VNode {
	return <AtomIODevtools store={props.store} hideByDefault />
}
