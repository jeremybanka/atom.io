import type { VNode } from "preact"
import * as React from "react"

import type { ToggleProps } from "./Toggle.tsx"
import css from "./ToggleButton.module.css"

const setCssVars = (
	vars: Record<`--${string}`, number | string>,
): Partial<React.CSSProperties> => vars

export function ToggleButton({
	children,
	checked,
	onChange,
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
			<label>
				<input type="checkbox" checked={checked} onChange={onChange} />
				<back-fill />
				<span>{children}</span>
			</label>
		</toggle-button>
	)
}
