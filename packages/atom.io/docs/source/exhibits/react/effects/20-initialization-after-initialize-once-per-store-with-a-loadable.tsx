import { useLoadable } from "@atom.io/react"
import { atom, getState, type Loadable } from "atom.io"

import { type Account, initializeApplication } from "./services.ts"

const sessionAtom = atom<Loadable<Account>, Error>({
	key: `session`,
	default: initializeApplication,
	catch: [Error],
})
// Invoke from the client entry point; repeated reads share this store's load.
export function startApplication(): void {
	getState(sessionAtom)
}
export function Application() {
	const account = useLoadable(sessionAtom, { name: `Starting` })
	return <output>{account.error ? `Failed` : account.value.name}</output>
}
