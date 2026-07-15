import type { VNode } from "preact"
import * as React from "react"

import type { ToggleProps } from "./Toggle.tsx"
import css from "./ToggleButton.module.css"

const setCssVars = (
	vars: Record<`--${string}`, number | string>,
): Partial<React.CSSProperties> => vars

export function ToggleButton({
	ariaControls,
	ariaLabel,
	children,
	checked,
	onClick,
	size = { height: 40, width: 40 },
}: ToggleProps): VNode {
	return (
		<toggle-button
			class={css.class}
			style={setCssVars({
				"--width": `${size.width}px`,
				"--height": `${size.height}px`,
			})}
		>
			<button
				aria-controls={ariaControls}
				aria-expanded={checked}
				aria-label={ariaLabel}
				onClick={onClick}
				type="button"
			>
				<back-fill aria-hidden="true" />
				<span aria-hidden="true">{children}</span>
			</button>
		</toggle-button>
	)
}
