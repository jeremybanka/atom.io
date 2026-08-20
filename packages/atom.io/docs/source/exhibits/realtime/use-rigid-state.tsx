import { usePullAtom, usePush, usePushStatus } from "atom.io/realtime-react"
import type { ReactElement } from "react"

import { sharedCountAtom } from "./declare-rigid-state"

export function SharedCounter(): ReactElement {
	const count = usePullAtom(sharedCountAtom)
	const setCount = usePush(sharedCountAtom)
	const lease = usePushStatus(sharedCountAtom)

	return (
		<button
			disabled={setCount === null}
			onClick={() => setCount?.((value) => value + 1)}
			type="button"
		>
			{count} · {lease.state}
		</button>
	)
}
