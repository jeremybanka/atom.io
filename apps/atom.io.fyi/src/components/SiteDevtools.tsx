import { AtomIODevtools } from "@atom.io/hydrogen-devtools"
import type { VNode } from "hydrogen"

export function SiteDevtools(props: { hideByDefault: boolean }): VNode {
	return (
		<site-devtools>
			<AtomIODevtools hideByDefault={props.hideByDefault} />
		</site-devtools>
	)
}
