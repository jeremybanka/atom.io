import { useEffect, useState } from "react"

import { every } from "./every.ts"

export function SavedLabel({ savedAt }: { savedAt: number }) {
	const [now, setNow] = useState(Date.now)
	useEffect(() => every(1000, () => setNow(Date.now())), [])
	return <output>Saved {Math.floor((now - savedAt) / 1000)} seconds ago</output>
}
