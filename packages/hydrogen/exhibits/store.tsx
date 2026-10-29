import type { VNode } from "@atom.io/hydrogen"
import { useStore } from "@atom.io/hydrogen"
import { atom } from "atom.io"
import { getFromStore } from "atom.io/internal"

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
