import type { VNode } from "@atom.io/spa"
import { useLoadable } from "@atom.io/spa"
import type { AstroStoreContext } from "@atom.io/spa/astro"
import type { Loadable } from "atom.io"
import { atom, Silo } from "atom.io"
import type { RootStore } from "atom.io/internal"
import { IMPLICIT } from "atom.io/internal"

const greetingAtom = atom<Loadable<string>>({
	key: `greeting`,
	default: ``,
})

export default function Greeting(): VNode {
	const greeting = useLoadable(greetingAtom, ``)
	return <p>{greeting().value}</p>
}

Greeting.createStore = async (
	props: { message: string },
	context: AstroStoreContext,
): Promise<RootStore> => {
	const silo = new Silo(
		{ name: `greeting`, lifespan: `ephemeral`, isProduction: true },
		IMPLICIT.STORE,
	)
	context.onCleanup(() => {
		silo.disposeState(greetingAtom)
	})
	// Use your asynchronous data preparation here. SSR and the browser must
	// observe the same initial value; context.element can provide a DOM sidecar.
	silo.setState(greetingAtom, Promise.resolve(props.message))
	await silo.getState(greetingAtom)
	context.signal.throwIfAborted()
	return silo.store
}
