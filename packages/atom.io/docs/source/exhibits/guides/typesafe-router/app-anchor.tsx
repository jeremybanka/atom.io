import type * as React from "react"

import type { Pathname } from "./route-shape.ts"

type AppAnchorProps = Omit<
	React.AnchorHTMLAttributes<HTMLAnchorElement>,
	`href`
> & {
	href: Pathname
}

export function AppAnchor(props: AppAnchorProps): React.JSX.Element {
	return <a {...props} />
}
