import { AtomIODevtools } from "@atom.io/devtools"
import type { SpaElement } from "@atom.io/spa"

export function SiteDevtools(props: { hideByDefault: boolean }): SpaElement {
	return (
		<site-devtools>
			<AtomIODevtools hideByDefault={props.hideByDefault} />
		</site-devtools>
	)
}
