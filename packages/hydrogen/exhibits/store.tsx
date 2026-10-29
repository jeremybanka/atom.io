import { atom } from "atom.io"
import { getFromStore } from "atom.io/internal"
import type { VNode } from "hydrogen"
import { useStore } from "hydrogen"

const countAtom = atom<number>({ key: `count`, default: 0 })

export function InspectCount(): VNode {
	const store = useStore()
	return (
		<button
			onClick={() => {
				console.log(getFromStore(store, countAtom))
			}}
		>
			Inspect current count
		</button>
	)
}
