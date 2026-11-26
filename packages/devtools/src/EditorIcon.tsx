/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

const paths = {
	generate: `M9 1 3 9h4l-1 6 7-8H9l1-6Z`,
	reset: `M3 6a5 5 0 1 1 0 4M3 3v3h3`,
	add: `M8 3v10M3 8h10`,
	sort: `M5 2v12m-3-3 3 3 3-3m1-8h5M9 6h4M9 9h3`,
	remove: `m4 4 8 8m0-8-8 8`,
	clearSelection: `M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4M6 6l4 4m0-4-4 4`,
	expand: `m6 4 4 4-4 4`,
	collapse: `m4 6 4 4 4-4`,
	arrow: `M2.5 8h11m-4-4 4 4-4 4`,
	externalLink: `M8 3H3v10h10V8m-3-5h3v3m0-3L7 9`,
	undo: `m6 3-4 4 4 4M2 7h7a4 4 0 0 1 4 4v2`,
	redo: `m10 3 4 4-4 4m4-4H7a4 4 0 0 0-4 4v2`,
	expandHistory: `M8 6V2M5 5l3-3 3 3m-3 5v4m-3-3 3 3 3-3`,
	collapseHistory: `M8 2v4m-3-3 3 3 3-3M8 14v-4m-3 3 3-3 3 3`,
	expandFamily: `M6 8H2m3-3-3 3 3 3M10 8h4m-3-3 3 3-3 3`,
	collapseFamily: `M2 8h4.5m-3-3 3 3-3 3M14 8H9.5m3-3-3 3 3 3`,
	reorder: `M5.5 4h1m3 0h1M5.5 8h1m3 0h1M5.5 12h1m3 0h1`,
}

export type EditorIconName = keyof typeof paths

export function EditorIcon(props: { name: EditorIconName }): SpaElement {
	return (
		<editor-icon>
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
		</editor-icon>
	)
}
