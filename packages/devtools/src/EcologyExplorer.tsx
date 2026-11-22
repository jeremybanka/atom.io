/** @jsxImportSource @atom.io/spa */
import { onCleanup, onMount, type SpaElement } from "@atom.io/spa"

import { type EcologyProps, mountEcology } from "./mount-ecology.ts"

/** Render an inline explorer with its own root in the inspected store. */
export function EcologyExplorer(props: EcologyProps): SpaElement {
	let host: HTMLElement | null = null
	onMount(() => {
		onCleanup(mountEcology(host!, props).dispose)
	})
	return (
		<ecology-explorer
			ref={(node) => {
				host = node
			}}
		/>
	)
}
