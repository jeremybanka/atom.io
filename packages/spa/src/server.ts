import type { Child, RootOptions } from "./core.ts"
import { renderToStringWithReads } from "./server-renderer.ts"

export function renderToString(
	setup: () => Child,
	options: RootOptions = {},
): string {
	return renderToStringWithReads(setup, options)
}
