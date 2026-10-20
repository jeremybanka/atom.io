import { StoreProvider } from "@atom.io/react"
import { AtomIODevtools } from "@atom.io/react-devtools"
import { createElement } from "react"

createElement(
	StoreProvider,
	null,
	createElement(AtomIODevtools, { hideByDefault: true }),
)
// @ts-expect-error The published props must retain their declaration.
createElement(AtomIODevtools, { hideByDefault: `wrong` })
