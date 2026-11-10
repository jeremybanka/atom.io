import type {
	Accessor,
	Children,
	Component,
	RootOptions,
	SpaRoot,
	TimelineControls,
} from "@atom.io/spa"
import * as Spa from "@atom.io/spa"
import {
	onCleanup,
	onMount,
	useDisposal,
	useGetter,
	useId,
	useRef,
	useSetter,
	useStore,
	useTimeline,
	useTransaction,
} from "@atom.io/spa"
import type { JSX } from "@atom.io/spa/jsx-runtime"
import type {
	disposeState,
	RegularAtomToken,
	TimelineToken,
	TransactionToken,
} from "atom.io"
import type { RootStore } from "atom.io/internal"

export const component: Component<{
	count: RegularAtomToken<number>
	element: RegularAtomToken<Element | null>
	history: TimelineToken<any>
	action: TransactionToken<(n: number) => string>
}> = (props) => {
	const store: RootStore = useStore()
	void store
	const dispose: typeof disposeState = useDisposal()
	void dispose
	// @ts-expect-error The hook gets its store from context and takes no arguments.
	useDisposal(props.count)
	const getCount: Accessor<number> = useGetter(props.count)
	const setCount = useSetter(props.count)
	setCount((n) => n + 1)
	const history: TimelineControls = useTimeline(props.history)
	const result: string = useTransaction(props.action)(1)
	const ref: (element: Element | null) => void = useRef(props.element)
	onMount(() => {
		ref(null)
	})
	onCleanup(history.clear)
	return [useId(), getCount(), result] satisfies Children
}
export const options: RootOptions = { idPrefix: `consumer` }
export type Root = SpaRoot
export const input: JSX.IntrinsicElements[`input`] = {
	onInput: (event) => {
		event.preventDefault()
	},
	value: 1,
}

// @ts-expect-error Dependency suppression is internal to the renderer.
Spa.untrack
