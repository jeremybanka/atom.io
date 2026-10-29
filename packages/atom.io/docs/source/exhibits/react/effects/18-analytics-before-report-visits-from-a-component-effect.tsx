import type { ReactNode } from "react"
import { useEffect } from "react"

import { recordVisit } from "./services.ts"

export function Screen({ screenId }: { screenId: string }): ReactNode {
	useEffect(() => {
		recordVisit(screenId)
	}, [screenId])
	return <main>{screenId}</main>
}
