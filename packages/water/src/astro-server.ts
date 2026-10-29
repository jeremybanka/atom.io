/* oxlint-disable typescript/require-await -- Astro requires async renderer callbacks, even for synchronous rendering. */
import type { NamedSSRLoadedRendererValue } from "astro"

import type { Island } from "./astro-shared.ts"
import { island, islandStore } from "./astro-shared.ts"
import { renderToString } from "./server.ts"

const renderer: NamedSSRLoadedRendererValue = {
	name: `@atom.io/water`,
	async check(component: Island) {
		return component?.water === true
	},
	async renderToStaticMarkup(component: Island, props, slots) {
		return {
			html: renderToString(() => island(component, props, slots), {
				store: islandStore(component, props),
				idPrefix: crypto.randomUUID(),
			}),
		}
	},
}
export default renderer
