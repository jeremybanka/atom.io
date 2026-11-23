/** @jsxImportSource @solidjs/web */
import { useI, useO, useTL } from "@atom.io/solid"
import type { JSX } from "@solidjs/web"

import {
	glyphNameAtoms,
	glyphTimelines,
} from "../core/timeline/create-a-timeline-family.ts"

export default function GlyphHistory(props: { glyphId?: string }): JSX.Element {
	const glyphId = props.glyphId ?? `example`
	const name = useO(glyphNameAtoms, glyphId)
	const setName = useI(glyphNameAtoms, glyphId)
	const history = useTL(glyphTimelines, glyphId)

	return (
		<>
			<input
				aria-label="Glyph name"
				value={name()}
				onInput={(event) => {
					setName(event.currentTarget.value)
				}}
			/>
			<output>
				{history().at} / {history().length}
			</output>
			<button
				type="button"
				disabled={history().at === 0}
				onClick={history().undo}
			>
				undo
			</button>
			<button
				type="button"
				disabled={history().at === history().length}
				onClick={history().redo}
			>
				redo
			</button>
		</>
	)
}
