/** @jsxImportSource solid-js */
import { useTL } from "atom.io/solid"
import type { JSX } from "solid-js"

import { glyphTimelines } from "../core/timeline/create-a-timeline-family.ts"

export function GlyphHistory(props: { glyphId: string }): JSX.Element {
	const history = useTL(glyphTimelines, props.glyphId)

	return (
		<>
			<span>
				{history().at} / {history().length}
			</span>
			<button type="button" onClick={history().undo}>
				undo
			</button>
			<button type="button" onClick={history().redo}>
				redo
			</button>
		</>
	)
}
