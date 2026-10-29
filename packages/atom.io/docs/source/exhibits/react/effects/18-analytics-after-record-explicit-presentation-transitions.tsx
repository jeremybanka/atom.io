import { useAtomicRef } from "@atom.io/react"
import { atomFamily } from "atom.io"
import { useRef } from "react"

import { recordVisit } from "./services.ts"

const presentedAtoms = atomFamily<HTMLElement | null, string>({
	key: `presented`,
	default: null,
	effects: (screenId) => [
		({ onSet }) => {
			onSet(({ newValue, oldValue }) => {
				if (newValue && !oldValue) recordVisit(screenId)
			})
		},
	],
})
export function Screen({ screenId }: { screenId: string }) {
	const node = useAtomicRef(presentedAtoms, screenId, useRef)
	return <main ref={node}>{screenId}</main>
}
