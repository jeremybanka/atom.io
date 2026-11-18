/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { LABELS } from "./window-controller.ts"
import type { Rect, SnapTarget } from "./window-geometry.ts"
import { rectStyle, SNAP_TARGETS } from "./window-geometry.ts"
import css from "./WindowOverlay.module.css"

export interface WindowPresentation {
	rect?: Rect
	preview?: Rect | undefined
	interaction: boolean
	paletteHidden: boolean
	menuOpen: boolean
	selected: SnapTarget | null
}
export function WindowOverlay(props: { state: WindowPresentation }): SpaElement {
	return (
		<window-overlay class={css.class} data-css="spa-devtools-window">
			<snap-preview
				aria-hidden="true"
				hidden={!props.state.preview}
				style={rectStyle(props.state.preview)}
			/>
			<snap-palette
				role="group"
				aria-label="Debugger layout"
				hidden={props.state.paletteHidden}
			>
				{SNAP_TARGETS.map((target) => (
					<button
						key={target}
						type="button"
						data-snap={target}
						aria-pressed={target === props.state.selected}
					>
						{LABELS[target]}
					</button>
				))}
				<button type="button" data-restore>
					Restore free position
				</button>
			</snap-palette>
		</window-overlay>
	)
}
