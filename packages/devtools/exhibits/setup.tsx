import "@atom.io/devtools/css"

import { AtomIODevtools } from "@atom.io/devtools"
import type { SpaElement } from "@atom.io/spa"
import type { RootStore } from "atom.io/internal"

export function Debugger(props: { store: RootStore }): SpaElement {
	return <AtomIODevtools store={props.store} hideByDefault />
}
