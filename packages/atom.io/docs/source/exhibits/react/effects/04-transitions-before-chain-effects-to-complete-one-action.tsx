import type { ReactNode } from "react"
import { useEffect, useState } from "react"

export function Game(): ReactNode {
	const [score, setScore] = useState(0)
	const [round, setRound] = useState(1)
	const [finished, setFinished] = useState(false)
	useEffect(() => {
		if (score >= 3) {
			setScore(0)
			setRound((value) => value + 1)
		}
	}, [score])
	useEffect(() => {
		setFinished(round > 3)
	}, [round])
	return (
		<button
			type="button"
			disabled={finished}
			onClick={() => {
				setScore((value) => value + 1)
			}}
		>
			Round {round}: {score}
		</button>
	)
}
