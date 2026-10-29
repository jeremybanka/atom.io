import { useO } from "@atom.io/react"
import { atom, runTransaction, selector, transaction } from "atom.io"

const scoreAtom = atom<number>({ key: `score`, default: 0 })
const roundAtom = atom<number>({ key: `round`, default: 1 })
const finishedSelector = selector<boolean>({
	key: `finished`,
	get: ({ get }) => get(roundAtom) > 3,
})
const scorePointTransaction = transaction<() => void>({
	key: `scorePoint`,
	do: ({ get, set }) => {
		if (get(finishedSelector)) return
		const next = get(scoreAtom) + 1
		set(scoreAtom, next === 3 ? 0 : next)
		if (next === 3) set(roundAtom, (round) => round + 1)
	},
})
const scorePoint = runTransaction(scorePointTransaction)
export function Game() {
	const score = useO(scoreAtom)
	const round = useO(roundAtom)
	const finished = useO(finishedSelector)
	return (
		<button type="button" disabled={finished} onClick={() => scorePoint()}>
			Round {round}: {score}
		</button>
	)
}
