import type { Children, RootOptions } from "./core.ts"
import { renderToStringWithReads } from "./server-renderer.ts"

export function renderToString(
	setup: () => Children,
	options: RootOptions = {},
): string {
	return renderToStringWithReads(setup, options)
}
