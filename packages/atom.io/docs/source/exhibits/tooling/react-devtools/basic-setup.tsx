import "@atom.io/react-devtools/css"

import { AtomIODevtools } from "@atom.io/react-devtools"

export function App() {
	return (
		<>
			<main>{/* your app */}</main>
			<AtomIODevtools />
		</>
	)
}
