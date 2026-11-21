/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import css from "./HighlightedText.module.css"

/** Renders only text and ranges already admitted by the passive search copy. */
export function HighlightedText(props: {
	text: string
	ranges: readonly [number, number][]
}): SpaElement {
	const parts = () => {
		let from = 0
		const result: (string | SpaElement)[] = []
		for (const [start, end] of props.ranges) {
			result.push(
				props.text.slice(from, start),
				<mark>{props.text.slice(start, end)}</mark>,
			)
			from = end
		}
		result.push(props.text.slice(from))
		return result
	}
	return <highlighted-text class={css.class}>{parts()}</highlighted-text>
}
