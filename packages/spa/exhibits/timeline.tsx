import type { VNode } from "@atom.io/spa"
import { useGetter, useTimeline, useTransaction } from "@atom.io/spa"
import { atom, timeline, transaction } from "atom.io"

const countAtom = atom<number>({ key: `count`, default: 0 })
const historyTimeline = timeline({ key: `history`, scope: [countAtom] })
const incrementTransaction = transaction<() => void>({
	key: `increment`,
	do: ({ get, set }) => {
		set(countAtom, get(countAtom) + 1)
	},
})

export function TimelineExample(): VNode {
	const getCount = useGetter(countAtom)
	const increment = useTransaction(incrementTransaction)
	const history = useTimeline(historyTimeline)
	return (
		<section>
			<output>
				Count: {getCount()} (history: {history.getCursor()}/{history.getLength()}
				)
			</output>
			<button onClick={increment}>Increment</button>
			<button
				disabled={history.getTransaction().undo === undefined}
				onClick={() => {
					history.getTransaction().undo?.()
				}}
			>
				Undo transaction
			</button>
			<button
				disabled={history.getTransaction().redo === undefined}
				onClick={() => {
					history.getTransaction().redo?.()
				}}
			>
				Redo transaction
			</button>
		</section>
	)
}
