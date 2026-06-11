import { flattenTree, type Tree } from "treetrunks"

type FrontendEntrypoint = Response
type RouteTree = Tree

export function createSpaFallbacks(
	index: FrontendEntrypoint,
	routes: RouteTree,
): Record<`/${string}`, FrontendEntrypoint> {
	return Object.fromEntries(
		flattenRouteTree(routes).map((path) => [
			`/${path.replace(/\$(\w+)/g, ":$1")}`,
			index,
		]),
	)
}

function flattenRouteTree(routes: RouteTree): string[] {
	return Object.keys(flattenTree(routes)).filter((path) => path.length > 0)
}
