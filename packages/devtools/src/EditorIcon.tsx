/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

const paths = {
	generate: `M9 1 3 9h4l-1 6 7-8H9l1-6Z`,
	reset: `M3 6a5 5 0 1 1 0 4M3 3v3h3`,
	add: `M8 3v10M3 8h10`,
	sort: `M5 2v12m-3-3 3 3 3-3m1-8h5M9 6h4M9 9h3`,
	remove: `m4 4 8 8m0-8-8 8`,
	expand: `m6 4 4 4-4 4`,
	collapse: `m4 6 4 4 4-4`,
	reorder: `M5.5 4h1m3 0h1M5.5 8h1m3 0h1M5.5 12h1m3 0h1`,
}

export type EditorIconName = keyof typeof paths

export function EditorIcon(props: { name: EditorIconName }): SpaElement {
	return (
		// eslint-disable-next-line lasertag/render-tag-with-own-name -- The SVG is the icon.
		<svg
			data-editor-icon={props.name}
			viewBox="0 0 16 16"
			width="14"
			height="14"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d={paths[props.name]} />
		</svg>
	)
}
