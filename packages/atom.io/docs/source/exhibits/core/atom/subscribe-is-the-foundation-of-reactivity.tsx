import { useO } from "atom.io/react"

import { countAtom } from "./declare-an-atom.ts"

function Component() {
	const count = useO(countAtom)
	return <>{count}</>
}
