import { useI, useO, useTL } from "@atom.io/react"

import { pointAtoms } from "../core/families/declare-a-family.tsx"
import { coordinatesTimeline } from "../core/timeline/create-a-timeline.ts"

export default function CoordinateHistory(): React.JSX.Element {
	const point = useO(pointAtoms, `example`)
	const setPoint = useI(pointAtoms, `example`)
	const { at, length, undo, redo } = useTL(coordinatesTimeline)
	return (
		<>
			<output>
				x: {point.x}, history: {at} / {length}
			</output>
			<div role="group" aria-label="History controls">
				<button
					type="button"
					onClick={() => {
						setPoint(({ x, y }) => ({ x: x + 1, y }))
					}}
				>
					Move right
				</button>
				<button type="button" disabled={at === 0} onClick={undo}>
					undo
				</button>
				<button type="button" disabled={at === length} onClick={redo}>
					redo
				</button>
			</div>
		</>
	)
}
