/**
 * Compile-only API proposal. Do not execute: its imported APIs are declarations,
 * and its JSX requires the proposed water compiler to preserve live expressions.
 */
import type { RegularAtomToken } from "atom.io"

import type { VNode } from "./runtime.ts"
import { useAtomicRef, useI, useId, useO } from "./water-api.proposal.ts"

export interface PointEditorProps {
	/** Token identity stays fixed for this component instance in this first proposal. */
	point: RegularAtomToken<{ x: number; y: number }>
	element: RegularAtomToken<SVGCircleElement | null>
}

export function PointEditor(props: PointEditorProps): VNode {
	const id = useId()
	const point = useO(props.point)
	const setPoint = useI(props.point)
	const circle = useAtomicRef(props.element)
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
