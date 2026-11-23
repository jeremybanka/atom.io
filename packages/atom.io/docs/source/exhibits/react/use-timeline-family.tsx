import { useI, useO, useTL } from "@atom.io/react"

import {
	glyphNameAtoms,
	glyphTimelines,
} from "../core/timeline/create-a-timeline-family.ts"

export default function GlyphHistory({
	glyphId = `example`,
}: {
	glyphId?: string
}): React.JSX.Element {
	const name = useO(glyphNameAtoms, glyphId)
	const setName = useI(glyphNameAtoms, glyphId)
	const { at, length, undo, redo, clear } = useTL(glyphTimelines, glyphId)

	return (
		<>
			<input
				aria-label="Glyph name"
				value={name}
				onChange={(event) => {
					setName(event.currentTarget.value)
				}}
			/>
			<output>
				{at} / {length}
			</output>
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
