import { ToggleButton } from "./ToggleButton.tsx"

export type ToggleProps = {
	ariaControls: string
	ariaLabel: string
	children: string
	checked: boolean
	onClick: () => void
	size?: { height: number; width: number }
}

export const Toggle = { Button: ToggleButton }
