import { useTL } from "atom.io/react"

import { coordinatesTimeline } from "../core/timeline/create-a-timeline.ts"

export function UrlDisplay(): React.JSX.Element {
	const { at, length, undo, redo } = useTL(coordinatesTimeline)
	return (
		<>
			<div>{at}</div>
			<div>{length}</div>
			<button type="button" onClick={undo}>
				undo
			</button>
			<button type="button" onClick={redo}>
				redo
			</button>
		</>
	)
}
