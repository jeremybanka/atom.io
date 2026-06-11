import type { Join, Tree, TreePath } from "treetrunks"
import { isTreePath, optional } from "treetrunks"

export const ROUTES = optional({
	login: null,
	grants: optional({
		$grantId: optional({
			applications: null,
		}),
	}),
})

export type Route = TreePath<typeof ROUTES>
export type Pathname = `/${Join<Route, "/">}`
export type PathnameWithSearch = `${Pathname}?${string}`

export function isRoute(path: unknown[]): path is Route {
	return isTreePath(ROUTES, path)
}
