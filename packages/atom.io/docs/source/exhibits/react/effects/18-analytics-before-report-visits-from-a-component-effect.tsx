import { useEffect } from "react"

import { recordVisit } from "./services.ts"

export function Screen({ screenId }: { screenId: string }) {
	useEffect(() => {
		recordVisit(screenId)
	}, [screenId])
	return <main>{screenId}</main>
}
