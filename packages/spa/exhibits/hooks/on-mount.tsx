import type { SpaElement } from "@atom.io/spa"
import { onMount } from "@atom.io/spa"

export function SearchDialog(): SpaElement {
	let input: HTMLInputElement | null = null
	onMount(() => input?.focus())
	return (
		<input
			aria-label="Search products"
			ref={(element) => {
				input = element
			}}
		/>
	)
}
