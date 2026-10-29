import { useEffect, useState } from "react"

import { type Account, loadAccount } from "./services.ts"

export function AccountName({ accountId }: { accountId: string }) {
	const [account, setAccount] = useState<Account | null>(null)
	const [error, setError] = useState(false)
	useEffect(() => {
		let current = true
		setAccount(null)
		setError(false)
		void loadAccount(accountId).then(
			(value) => {
				if (current) setAccount(value)
			},
			() => {
				if (current) setError(true)
			},
		)
		return () => {
			current = false
		}
	}, [accountId])
	return <output>{error ? `Failed` : (account?.name ?? `Loading`)}</output>
}
