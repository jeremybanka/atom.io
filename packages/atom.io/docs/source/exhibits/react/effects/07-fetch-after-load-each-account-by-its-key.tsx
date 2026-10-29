import { useLoadable } from "@atom.io/react"
import { atomFamily, type Loadable } from "atom.io"
import type { ReactNode } from "react"

import { type Account, loadAccount } from "./services.ts"

const accountAtoms = atomFamily<Loadable<Account>, string, Error>({
	key: `account`,
	default: loadAccount,
	catch: [Error],
})
function AccountResult({ accountId }: { accountId: string }) {
	const account = useLoadable(accountAtoms, accountId, { name: `Loading` })
	return <output>{account.error ? `Failed` : account.value.name}</output>
}
export function AccountName({ accountId }: { accountId: string }): ReactNode {
	// Reset the hook's retained display value when the request identity changes.
	return <AccountResult key={accountId} accountId={accountId} />
}
