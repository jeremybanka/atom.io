import type { VNode } from "hydrogen"

import type { ToggleProps } from "./Toggle.tsx"
import css from "./ToggleButton.module.css"

export function ToggleButton(props: ToggleProps): VNode {
	const size = () => props.size ?? { height: 40, width: 40 }
	return (
		<toggle-button
			class={css.class}
			style={`--width:${size().width}px;--height:${size().height}px`}
		>
			<button
				aria-controls={props.ariaControls}
				aria-expanded={props.checked}
				aria-label={props.ariaLabel}
				onClick={props.onClick}
				type="button"
			>
				<back-fill aria-hidden="true" />
				<span aria-hidden="true">{props.children}</span>
			</button>
		</toggle-button>
	)
}
