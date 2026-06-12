import { Button } from "./ToggleButton.tsx"

export type ToggleProps = {
	children: string
	checked: boolean
	onChange: () => void
}

export const Toggle = { Button }
