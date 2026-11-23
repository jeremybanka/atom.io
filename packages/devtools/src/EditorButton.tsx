/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

const paths = {
	generate: `M9 1 3 9h4l-1 6 7-8H9l1-6Z`,
	reset: `M3 6a5 5 0 1 1 0 5m0-9v4h4`,
	add: `M8 3v10M3 8h10`,
	sort: `M5 2v12m-3-3 3 3 3-3m1-8h5M9 6h4M9 9h3`,
	remove: `m4 4 8 8m0-8-8 8`,
}

export function EditorButton(props: {
	icon: keyof typeof paths
	label: string
	onClick(): void
}): SpaElement {
	return (
		// eslint-disable-next-line lasertag/render-tag-with-own-name -- Keep the native button as the editor control.
		<button
			type="button"
			aria-label={props.label}
			title={props.label}
			onClick={props.onClick}
		>
			<svg
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
				<path d={paths[props.icon]} />
			</svg>
		</button>
	)
}
