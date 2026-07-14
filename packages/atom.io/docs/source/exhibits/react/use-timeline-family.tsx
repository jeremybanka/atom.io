import { useTL } from "atom.io/react"

import { glyphTimelines } from "../core/timeline/create-a-timeline-family.ts"

export function GlyphHistory(props: { glyphId: string }): React.JSX.Element {
	const { at, length, undo, redo, clear } = useTL(glyphTimelines, props.glyphId)

	return (
		<>
			<span>
				{at} / {length}
			</span>
			<button type="button" disabled={at === 0} onClick={undo}>
				undo
			</button>
			<button type="button" disabled={at === length} onClick={redo}>
				redo
			</button>
			<button type="button" onClick={clear}>
				clear history
			</button>
		</>
	)
}
