import type { SpaElement } from "@atom.io/spa"
import { onCleanup, onMount } from "@atom.io/spa"

export function AccountSettings(): SpaElement {
	onMount(() => {
		const previousTitle = document.title
		document.title = `Account settings`
		onCleanup(() => {
			document.title = previousTitle
		})
	})
	return <h1>Account settings</h1>
}
