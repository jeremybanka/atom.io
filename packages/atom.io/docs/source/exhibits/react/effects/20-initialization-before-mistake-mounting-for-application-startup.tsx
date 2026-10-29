import type { ReactNode } from "react"
import { useEffect, useState } from "react"

import { type Account, initializeApplication } from "./services.ts"

export function Application(): ReactNode {
	const [account, setAccount] = useState<Account | null>(null)
	const [failed, setFailed] = useState(false)
	useEffect(() => {
		// An empty dependency list does not mean once per application.
		void initializeApplication().then(setAccount, () => {
			setFailed(true)
		})
	}, [])
	return <output>{failed ? `Failed` : (account?.name ?? `Starting`)}</output>
}
