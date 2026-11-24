/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { LABELS } from "./window-controller.ts"
import type { Rect, SnapTarget } from "./window-geometry.ts"
import { rectStyle, SNAP_TARGETS, snapRect } from "./window-geometry.ts"
import css from "./WindowOverlay.module.css"

export interface WindowPresentation {
	rect?: Rect
	preview?: Rect | undefined
	interaction: boolean
	paletteHidden: boolean
	menuOpen: boolean
	selected: SnapTarget | null
}

function SnapIcon(props: { target?: SnapTarget }): SpaElement {
	const tile = props.target && snapRect(props.target, { width: 24, height: 16 })
	return (
		<svg
			viewBox="0 0 28 20"
			width="28"
			height="20"
			fill="none"
			aria-hidden="true"
			focusable="false"
		>
			{tile ? (
				<>
					<rect
						x="1"
						y="1"
						width="26"
						height="18"
						rx="2"
						stroke="var(--snap-context-stroke)"
					/>
					<rect
						x={tile.x + 2}
						y={tile.y + 2}
						width={tile.width}
						height={tile.height}
						rx="1"
						fill="currentColor"
					/>
				</>
			) : (
				<path
					d="M9 5l10 10M19 5L9 15"
					stroke="currentColor"
					stroke-width="1.25"
					stroke-linecap="round"
				/>
			)}
		</svg>
	)
}

export function WindowOverlay(props: { state: WindowPresentation }): SpaElement {
	return (
		<window-overlay class={css.class} data-css="devtools-window">
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
						aria-label={LABELS[target]}
						aria-pressed={target === props.state.selected}
						title={LABELS[target]}
					>
						<SnapIcon target={target} />
					</button>
				))}
				<button
					type="button"
					data-restore
					aria-label="Restore free position"
					title="Restore free position"
				>
					<SnapIcon />
				</button>
			</snap-palette>
		</window-overlay>
	)
}
