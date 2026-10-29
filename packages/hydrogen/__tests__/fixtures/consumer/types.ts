import type { RegularAtomToken, TimelineToken, TransactionToken } from "atom.io"
import type { RootStore } from "atom.io/internal"
import type {
	Accessor,
	Child,
	Component,
	HydrogenRoot,
	RootOptions,
	TimelineValue,
} from "hydrogen"
import * as Hydrogen from "hydrogen"
import {
	onCleanup,
	onMount,
	useId,
	useRef,
	useSetter,
	useStore,
	useTimeline,
	useTransaction,
	useValue,
} from "hydrogen"
import type { JSX } from "hydrogen/jsx-runtime"

export const component: Component<{
	count: RegularAtomToken<number>
	element: RegularAtomToken<Element | null>
	history: TimelineToken<any>
	action: TransactionToken<(n: number) => string>
}> = (props) => {
	const store: RootStore = useStore()
	void store
	const value: Accessor<number> = useValue(props.count)
	useSetter(props.count)((n) => n + 1)
	const history: TimelineValue = useTimeline(props.history)()
	const result: string = useTransaction(props.action)(1)
	const ref: (element: Element | null) => void = useRef(props.element)
	onMount(() => {
		ref(null)
	})
	onCleanup(history.clear)
	return [useId(), value(), result] satisfies Child
}
export const options: RootOptions = { idPrefix: `consumer` }
export type Root = HydrogenRoot
export const input: JSX.IntrinsicElements[`input`] = {
	onInput: (event) => {
		event.preventDefault()
	},
	value: 1,
}

// @ts-expect-error Dependency suppression is internal to the renderer.
Hydrogen.untrack
