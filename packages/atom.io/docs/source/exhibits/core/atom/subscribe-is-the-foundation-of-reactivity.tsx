import { useO } from "@atom.io/react"

import { countAtom } from "./declare-an-atom.ts"

export default function Counter(): React.JSX.Element {
	const count = useO(countAtom)
	return <>{count}</>
}
