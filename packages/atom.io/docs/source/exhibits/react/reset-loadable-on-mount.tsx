import { atom, resetState, type Loadable } from "atom.io"
import { useLoadable } from "atom.io/react"
import { useEffect } from "react"

type QueryResult = {
	title: string
}

const queryAtom = atom<Loadable<QueryResult>, Error>({
	key: `loadableOwnershipQuery`,
	default: async () => ({ title: `Loaded` }),
	catch: [Error],
})

export function QueryPanel(): React.JSX.Element {
	const query = useLoadable(queryAtom, { title: `Loading` })

	// @exhibit-region start reset-loadable-on-mount
	useEffect(() => {
		resetState(queryAtom) // ❌ do not reset on mount; duplicates async work
	}, [])
	// @exhibit-region end reset-loadable-on-mount

	return <h1>{query.value.title}</h1>
}
