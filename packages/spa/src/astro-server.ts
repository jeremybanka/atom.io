/* oxlint-disable typescript/require-await -- Astro requires async renderer callbacks, even for synchronous rendering. */
import type { NamedSSRLoadedRendererValue } from "astro"

import { failPreparation, storeContext } from "./astro-context.ts"
import { requestApplication } from "./astro-request.ts"
import type { Island } from "./astro-shared.ts"
import { island, islandStore } from "./astro-shared.ts"
import { renderToString } from "./server.ts"

const renderer: NamedSSRLoadedRendererValue = {
	name: `spa`,
	async check(component: Island) {
		return component?.spa === true
	},
	async renderToStaticMarkup(component: Island, props, slots) {
		const request = (this as unknown as { result?: { request: Request } }).result
			?.request
		const shared =
			!component.createStore && !component.isolate && request
				? requestApplication(request)
				: undefined
		const lifetime = storeContext(undefined, shared?.application)
		try {
			const store = await islandStore(
				component,
				props,
				lifetime.context,
				shared?.store,
			)
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
