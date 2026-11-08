import "@atom.io/spa-devtools/css"

import type { SpaElement } from "@atom.io/spa"
import { AtomIODevtools } from "@atom.io/spa-devtools"
import type { RootStore } from "atom.io/internal"

export function Debugger(props: { store: RootStore }): SpaElement {
	return <AtomIODevtools store={props.store} hideByDefault />
}
