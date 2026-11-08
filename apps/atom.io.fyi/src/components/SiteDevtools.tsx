import type { SpaElement } from "@atom.io/spa"
import { AtomIODevtools } from "@atom.io/spa-devtools"

export function SiteDevtools(props: { hideByDefault: boolean }): SpaElement {
	return (
		<site-devtools>
			<AtomIODevtools hideByDefault={props.hideByDefault} />
		</site-devtools>
	)
}
