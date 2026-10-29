import type { VNode } from "@atom.io/hydrogen"
import { AtomIODevtools } from "@atom.io/hydrogen-devtools"

export function SiteDevtools(props: { hideByDefault: boolean }): VNode {
	return (
		<site-devtools>
			<AtomIODevtools hideByDefault={props.hideByDefault} />
		</site-devtools>
	)
}
