import type { SpaElement } from "@atom.io/spa"
import { useLoadable } from "@atom.io/spa"
import { atom, type Loadable } from "atom.io"

const accountNameAtom = atom<Loadable<string>, Error>({
	key: `accountName`,
	default: () =>
		new Promise<string>((resolve) => {
			setTimeout(() => {
				resolve(`Ada Lovelace`)
			}, 750)
		}),
	catch: [Error],
})

export default function AccountName(): SpaElement {
	const accountName = useLoadable(accountNameAtom, `Loading your account…`)
	return (
		<p aria-busy={accountName().loading}>
			{accountName().error?.message ?? accountName().value}
		</p>
	)
}
