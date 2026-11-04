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
	const count = useGetter(countAtom)
	const increment = useTransaction(incrementTransaction)
	const { getCursor, getLength, undo, redo } = useTimeline(historyTimeline)
	return (
		<section>
			<output>
				Count: {count()} (history: {getCursor()}/{getLength()})
			</output>
			<button onClick={increment}>Increment</button>
			<button
				disabled={undo.getTransaction() === undefined}
				onClick={() => {
					undo.getTransaction()?.()
				}}
			>
				Undo transaction
			</button>
			<button
				disabled={redo.getTransaction() === undefined}
				onClick={() => {
					redo.getTransaction()?.()
				}}
			>
				Redo transaction
			</button>
		</section>
	)
}
