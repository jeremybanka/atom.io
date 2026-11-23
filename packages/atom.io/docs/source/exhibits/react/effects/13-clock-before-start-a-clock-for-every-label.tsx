import type { ReactNode } from "react"
import { useEffect, useState } from "react"

import { every } from "./every.ts"

const exampleSavedAt = Date.now()

export default function SavedLabel({
	savedAt = exampleSavedAt,
}: {
	savedAt?: number
}): ReactNode {
	const [now, setNow] = useState(Date.now)
	useEffect(
		() =>
			every(1000, () => {
				setNow(Date.now())
			}),
		[],
	)
	return <output>Saved {Math.floor((now - savedAt) / 1000)} seconds ago</output>
}
