import type {
	Accessor,
	Child,
	Component,
	RootOptions,
	TimelineValue,
	WaterRoot,
} from "@atom.io/water"
import {
	onCleanup,
	onMount,
	untrack,
	useId,
	useRef,
	useSetter,
	useTimeline,
	useTransaction,
	useValue,
} from "@atom.io/water"
import type { JSX } from "@atom.io/water/jsx-runtime"
import type { RegularAtomToken, TimelineToken, TransactionToken } from "atom.io"

export const component: Component<{
	count: RegularAtomToken<number>
	element: RegularAtomToken<Element | null>
	history: TimelineToken<any>
	action: TransactionToken<(n: number) => string>
}> = (props) => {
	const value: Accessor<number> = useValue(props.count)
	useSetter(props.count)((n) => n + 1)
	const history: TimelineValue = useTimeline(props.history)()
	const result: string = useTransaction(props.action)(1)
	const ref: (element: Element | null) => void = useRef(props.element)
	onMount(() => {
		ref(null)
	})
	onCleanup(history.clear)
	return [useId(), untrack(value), result] satisfies Child
}
export const options: RootOptions = { idPrefix: `consumer` }
export type Root = WaterRoot
export const input: JSX.IntrinsicElements[`input`] = {
	onInput: (event) => {
		event.preventDefault()
	},
	value: 1,
}
