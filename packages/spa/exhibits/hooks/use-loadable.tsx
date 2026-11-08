import type { SpaElement } from "@atom.io/spa"
import { useLoadable } from "@atom.io/spa"
import { atom, type Loadable } from "atom.io"

const accountNameAtom = atom<Loadable<string>, Error>({
	key: `accountName`,
	default: async () => {
		const response = await fetch(`/api/account/name`)
		if (!response.ok) throw new Error(`Could not load your account`)
		return response.text()
	},
	catch: [Error],
})

export function AccountName(): SpaElement {
	const accountName = useLoadable(accountNameAtom, `Loading your account…`)
	return (
		<p aria-busy={accountName().loading}>
			{accountName().error?.message ?? accountName().value}
		</p>
	)
}
