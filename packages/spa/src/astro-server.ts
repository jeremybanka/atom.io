/* oxlint-disable typescript/require-await -- Astro requires async renderer callbacks, even for synchronous rendering. */
import type { NamedSSRLoadedRendererValue } from "astro"

import { failPreparation, storeContext } from "./astro-context.ts"
import { requestApplication } from "./astro-request.ts"
import type { Island } from "./astro-shared.ts"
import { island, islandStore } from "./astro-shared.ts"
import { renderToStringWithReads } from "./server-renderer.ts"

export const createRenderer = (
	awaitState = false,
): NamedSSRLoadedRendererValue => ({
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
			const options = {
				store,
				idPrefix: crypto.randomUUID(),
				capabilities: component.capabilities ?? [],
			}
			// Retry only after reads made by this view settle. Each discarded render
			// releases its scopes; conditional branches can discover more async state.
			for (;;) {
				lifetime.context.signal.throwIfAborted()
				const pending = new Set<Promise<unknown>>()
				const html = renderToStringWithReads(
					() => () => island(component, props, slots),
					options,
					awaitState
						? (value) => {
								if (value instanceof Promise) pending.add(value)
							}
						: undefined,
				)
				if (!pending.size) return { html }
				// Caught producer errors resolve as state values. An uncaught failure
				// must reject this render with its original error.
				await Promise.race([Promise.all(pending), lifetime.cancelled])
			}
		} catch (error) {
			failPreparation(error, lifetime.dispose)
		} finally {
			lifetime.dispose()
		}
	},
})
export default createRenderer()
