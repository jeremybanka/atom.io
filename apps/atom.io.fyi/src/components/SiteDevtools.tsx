import type { VNode } from "@atom.io/water"
import { AtomIODevtools } from "@atom.io/water-devtools"

export function SiteDevtools(props: { hideByDefault: boolean }): VNode {
	return (
		<site-devtools>
			<AtomIODevtools hideByDefault={props.hideByDefault} />
		</site-devtools>
	)
}
