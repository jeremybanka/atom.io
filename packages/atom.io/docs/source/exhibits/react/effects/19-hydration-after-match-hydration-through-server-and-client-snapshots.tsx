import { useO } from "@atom.io/react"
import { atom } from "atom.io"
import type { ReactNode } from "react"
import { useSyncExternalStore } from "react"

const displayNameAtom = atom<string>({
	key: `displayName`,
	default: () =>
		typeof window === `undefined`
			? `guest`
			: (localStorage.getItem(`displayName`) ?? `guest`),
})
const subscribe = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false
function ClientGreeting() {
	const name = useO(displayNameAtom)
	return <output>Welcome, {name}</output>
}
export function Greeting(): ReactNode {
	const hydrated = useSyncExternalStore(
		subscribe,
		clientSnapshot,
		serverSnapshot,
	)
	return hydrated ? <ClientGreeting /> : <output>Welcome</output>
}
