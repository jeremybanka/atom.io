/**
 * Compile-only API proposal. Do not execute: its imported APIs are declarations,
 * and its JSX requires the proposed water compiler to preserve live expressions.
 */
import type { RegularAtomToken, TimelineToken } from "atom.io"

import type { VNode } from "./runtime.ts"
import {
	useId,
	useRef,
	useSetter,
	useTimeline,
	useValue,
} from "./water-api.proposal.ts"

export interface PointEditorProps {
	/** Token identity stays fixed for this component instance in this first proposal. */
	point: RegularAtomToken<{ x: number; y: number }>
	element: RegularAtomToken<SVGCircleElement | null>
}

export function PointEditor(props: PointEditorProps): VNode {
	const id = useId()
	const point = useValue(props.point)
	const setPoint = useSetter(props.point)
	const circle = useRef(props.element)
	const move = () => {
		setPoint(({ x, y }) => ({ x: x + 1, y: y + 1 }))
	}

	return (
		<section>
			<svg viewBox="0 0 100 100" aria-labelledby={`${id}-title`}>
				<title id={`${id}-title`}>Point editor</title>
				<circle ref={circle} cx={point().x} cy={point().y} r="4" />
			</svg>
			<output aria-live="polite">
				({point().x}, {point().y})
			</output>
			<button onClick={move}>Move diagonally</button>
		</section>
	)
}

export function HistoryControls(props: {
	timeline: TimelineToken<unknown>
}): VNode {
	const history = useTimeline(props.timeline)
	return (
		<nav aria-label="History">
			<output>
				{history().at} / {history().length}
			</output>
			<button
				onClick={() => {
					history().undo()
				}}
			>
				Undo
			</button>
			<button
				onClick={() => {
					history().redo()
				}}
			>
				Redo
			</button>
		</nav>
	)
}
