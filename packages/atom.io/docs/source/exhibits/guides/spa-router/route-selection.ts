import type { AtomToken } from "atom.io"
import { selector } from "atom.io"

import { pathnameAtom } from "./pathname-state"
import { isRoute, type Route } from "./route-shape"

declare const authAtom: AtomToken<boolean | null>
declare function isPublicRoute(path: Route): boolean

export const routeSelector = selector<Route | 404>({
	key: "route",
	get: ({ get }) => {
		const pathname = get(pathnameAtom)
		const path = pathname.split("/").slice(1).filter(Boolean)

		if (!isRoute(path)) {
			return 404
		}

		if (isPublicRoute(path)) {
			return path
		}

		const auth = get(authAtom)
		if (!auth) {
			return ["login"]
		}

		if (path.length === 0) {
			return ["grants"]
		}

		return path
	},
})
