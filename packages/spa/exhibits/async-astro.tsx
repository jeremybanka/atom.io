import type { VNode } from "@atom.io/spa"
import { useLoadable } from "@atom.io/spa"
import type { AstroStorePreparation } from "@atom.io/spa/astro"
import type { Loadable } from "atom.io"
import { atom } from "atom.io"
import { disposeFromStore, getFromStore, setIntoStore } from "atom.io/internal"

const greetingAtom = atom<Loadable<string>>({
	key: `greeting`,
	default: ``,
})

export default function Greeting(): VNode {
	const greeting = useLoadable(greetingAtom, ``)
	return <p>{greeting().value}</p>
}

const prepare: AstroStorePreparation<{ message: string }> = async (
	store,
	props,
	context,
) => {
	context.onCleanup(() => {
		disposeFromStore(store, greetingAtom)
	})
	// Use your asynchronous data preparation here. SSR and the browser must
	// observe the same initial value; context.element can provide a DOM sidecar.
	setIntoStore(store, greetingAtom, Promise.resolve(props.message))
	await getFromStore(store, greetingAtom)
}
Greeting.isolate = true
Greeting.prepareStore = prepare
