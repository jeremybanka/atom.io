/* oxlint-disable typescript/require-await -- Astro requires async renderer callbacks, even for synchronous rendering. */
import type { NamedSSRLoadedRendererValue } from "astro"

import { failPreparation, storeContext } from "./astro-context.ts"
import type { Island } from "./astro-shared.ts"
import { island, islandStore } from "./astro-shared.ts"
import { renderToString } from "./server.ts"

const renderer: NamedSSRLoadedRendererValue = {
	name: `spa`,
	async check(component: Island) {
		return component?.spa === true
	},
	async renderToStaticMarkup(component: Island, props, slots) {
		const lifetime = storeContext()
		try {
			const store = await islandStore(component, props, lifetime.context)
			return {
				html: renderToString(() => () => island(component, props, slots), {
					store,
					idPrefix: crypto.randomUUID(),
				}),
			}
		} catch (error) {
			failPreparation(error, lifetime.dispose)
		} finally {
			lifetime.dispose()
		}
	},
}
export default renderer
