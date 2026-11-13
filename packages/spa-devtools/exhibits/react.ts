import "@atom.io/spa-devtools/css"

import { StoreProvider } from "@atom.io/react"
import { AtomIODevtools } from "@atom.io/spa-devtools/react"
import type { RootStore } from "atom.io/internal"
import type { ReactElement } from "react"
import { createElement } from "react"

export function Debugger({ store }: { store: RootStore }): ReactElement {
	return createElement(StoreProvider, {
		store,
		children: createElement(AtomIODevtools),
	})
}
