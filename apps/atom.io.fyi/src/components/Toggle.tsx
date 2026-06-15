import { ToggleButton } from "./ToggleButton.tsx"

export type ToggleProps = {
	children: string
	checked: boolean
	onChange: () => void
	size?: { height: number; width: number }
}

export const Toggle = { Button: ToggleButton }
