import { useO } from "atom.io/react"
import type * as React from "react"

import { routeSelector } from "./route-selection.ts"

declare function NotFoundPage(): React.JSX.Element
declare function LoginPage(): React.JSX.Element
declare function DocDetail(props: { docId: string }): React.JSX.Element
declare function DocsIndex(): React.JSX.Element

function CurrentRoute(): React.JSX.Element {
	const route = useO(routeSelector)

	if (route === 404) {
		return <NotFoundPage />
	}

	if (route.length === 0) {
		return <DocsIndex />
	}

	switch (route[0]) {
		case `login`:
			return <LoginPage />

		case `docs`:
			if (route.length === 2) {
				return <DocDetail docId={route[1]} />
			}
			return <DocsIndex />

		default:
			return <NotFoundPage />
	}
}
