import type { SpaElement } from "@atom.io/spa"
import {
	onCleanup,
	onMount,
	useGetter,
	useId,
	useSetter,
	useTimeline,
} from "@atom.io/spa"
import { threeRenderer } from "@atom.io/spa/three"
import type { RegularAtomToken, TimelineToken } from "atom.io"

import { Scene } from "./Scene.tsx"
import { cleanups, parents, refs } from "./state.ts"

export default function App(props: {
	name: string
	token: RegularAtomToken<number>
	history: TimelineToken<RegularAtomToken<number>>
}): SpaElement {
	const getCount = useGetter(props.token),
		setCount = useSetter(props.token)
	const history = useTimeline(props.history)
	const id = useId()
	onCleanup(() => {
		cleanups.dom++
	})
	onMount(() => {
		threeRenderer.mount(
			() => <Scene token={props.token} />,
			parents.get(props.name)!,
		)
	})
	// HMR_EDIT_POINT
	return (
		<button
			id={id}
			data-hmr={props.name}
			ref={(element) => {
				refs[props.name] = element
			}}
			onClick={() => {
				setCount((value) => value + 1)
			}}
		>
			view-v1:{getCount()}:{history.getCursor()}
		</button>
	)
}
