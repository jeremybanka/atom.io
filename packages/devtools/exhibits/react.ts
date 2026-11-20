import "@atom.io/devtools/css"

import { AtomIODevtools } from "@atom.io/devtools/react"
import { StoreProvider } from "@atom.io/react"
import type { RootStore } from "atom.io/internal"
import type { ReactElement } from "react"
import { createElement } from "react"

export function Debugger({ store }: { store: RootStore }): ReactElement {
	return createElement(StoreProvider, {
		store,
		children: createElement(AtomIODevtools),
	})
}
