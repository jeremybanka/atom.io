/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"

import { EditorIcon, type EditorIconName } from "./EditorIcon.tsx"

export function EditorButton(props: {
	icon: EditorIconName
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
			<EditorIcon name={props.icon} />
		</button>
	)
}
