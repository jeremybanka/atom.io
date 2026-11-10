import type { Children, SpaElement } from "@atom.io/spa"
import { onCleanup, useGetter, useId, useSetter } from "@atom.io/spa"

import { countAtom } from "./state.ts"

const counters = globalThis as typeof globalThis & { spaIslandCleanups?: number }
export default function View(props: {
	initial: number
	children?: Children
}): SpaElement {
	const getCount = useGetter(countAtom),
		setCount = useSetter(countAtom),
		id = useId()
	onCleanup(() => {
		counters.spaIslandCleanups = (counters.spaIslandCleanups ?? 0) + 1
	})
	return (
		<>
			{props.children}
			<button
				id={id}
				data-initial={props.initial}
				onClick={() => {
					setCount((value) => value + 1)
				}}
			>
				astro-v1:{getCount()}
			</button>
		</>
	)
}
