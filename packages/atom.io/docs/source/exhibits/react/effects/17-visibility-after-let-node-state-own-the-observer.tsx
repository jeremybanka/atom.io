import { useAtomicRef, useO } from "@atom.io/react"
import { atomFamily, setState } from "atom.io"
import { useRef } from "react"

import { observeVisibility } from "./helpers.ts"

const visibleAtoms = atomFamily<boolean, string>({
	key: `visible`,
	default: false,
})
const cardNodeAtoms = atomFamily<HTMLDivElement | null, string>({
	key: `cardNode`,
	default: null,
	effects: (cardId) => [
		({ onSet }) => {
			let stopObserving = () => {}
			onSet(({ newValue }) => {
				stopObserving()
				setState(visibleAtoms, cardId, false)
				stopObserving = observeVisibility(newValue, (visible) => {
					setState(visibleAtoms, cardId, visible)
				})
			})
			return () => stopObserving()
		},
	],
})
export function Card({ cardId }: { cardId: string }) {
	const node = useAtomicRef(cardNodeAtoms, cardId, useRef)
	const visible = useO(visibleAtoms, cardId)
	return <div ref={node}>{visible ? `In view` : `Outside viewport`}</div>
}
