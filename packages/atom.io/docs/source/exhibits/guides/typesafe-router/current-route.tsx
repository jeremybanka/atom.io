import { useO } from "atom.io/react"
import type * as React from "react"

import { routeSelector } from "./route-selection.ts"

declare function NotFoundPage(): React.JSX.Element
declare function LoginPage(): React.JSX.Element
declare function GrantDetail(props: { grantId: string }): React.JSX.Element
declare function GrantIndex(): React.JSX.Element

function CurrentRoute(): React.JSX.Element {
	const route = useO(routeSelector)

	if (route === 404) {
		return <NotFoundPage />
	}

	if (route.length === 0) {
		return <GrantIndex />
	}

	switch (route[0]) {
		case `login`:
			return <LoginPage />

		case `grants`:
			if (route.length === 2) {
				return <GrantDetail grantId={route[1]} />
			}
			return <GrantIndex />

		default:
			return <NotFoundPage />
	}
}
