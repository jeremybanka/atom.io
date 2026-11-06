import "@atom.io/spa-devtools/css"

import type { VNode } from "@atom.io/spa"
import { AtomIODevtools } from "@atom.io/spa-devtools"
import type { RootStore } from "atom.io/internal"

export function Debugger(props: { store: RootStore }): VNode {
	return <AtomIODevtools store={props.store} hideByDefault />
}
