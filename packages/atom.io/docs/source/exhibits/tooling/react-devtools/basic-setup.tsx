import "@atom.io/react-devtools/css"

import { AtomIODevtools } from "@atom.io/react-devtools"
import type { JSX } from "react"

export function App(): JSX.Element {
	return (
		<>
			<main>{/* your app */}</main>
			<AtomIODevtools />
		</>
	)
}
