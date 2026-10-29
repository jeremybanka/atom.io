import { atom, Silo } from "atom.io"
import { IMPLICIT } from "atom.io/internal"
import type { Child, VNode } from "hydrogen"
import { onCleanup, useId, useSetter, useValue } from "hydrogen"

const countAtom = atom<number>({ key: `count`, default: 0 })
export default function Counter(props: {
	initial: number
	children?: Child
	slots?: Record<string, Child>
}): VNode {
	const count = useValue(countAtom)
	const setCount = useSetter(countAtom)
	const id = useId()
	onCleanup(() => {
		/* Release imperative resources owned by this instance here. */
	})
	return (
		<section aria-labelledby={id}>
			<h2 id={id}>Counter</h2>
			{props.slots?.[`heading`]}
			{props.children}
			<button
				onClick={() => {
					setCount((value) => value + 1)
				}}
			>
				{count()}
			</button>
		</section>
	)
}

// Astro calls this on the server and in the browser with the same serialized props.
Counter.createStore = (props: { initial: number }) => {
	const silo = new Silo(
		{ name: `counter-island`, lifespan: `ephemeral`, isProduction: true },
		IMPLICIT.STORE,
	)
	silo.setState(countAtom, props.initial)
	return silo.store
}
