/* oxlint-disable typescript/require-await -- Astro requires async renderer callbacks, even for synchronous rendering. */
import type { NamedSSRLoadedRendererValue } from "astro"
import type { ReadableToken } from "atom.io"

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
		const requestOwner = request ? requestApplication(request) : undefined
		const shared =
			!component.createStore && !component.isolate ? requestOwner : undefined
		const lifetime = storeContext(undefined, shared?.application)
		if (requestOwner && !shared) {
			lifetime.context.onCleanup(
				requestOwner.application.onCleanup(lifetime.dispose),
			)
		}
		try {
			lifetime.context.signal.throwIfAborted()
			const store = await Promise.race([
				islandStore(component, props, lifetime.context, shared?.store),
				lifetime.cancelled,
			])
			lifetime.context.signal.throwIfAborted()
			const options = {
				store: store!,
				idPrefix: crypto.randomUUID(),
				capabilities: component.capabilities ?? [],
			}
			// Retry only after reads made by this view settle. Each discarded render
			// releases its scopes; conditional branches can discover more async state.
			for (;;) {
				lifetime.context.signal.throwIfAborted()
				const reads = new Map<string, ReadableToken<unknown>>()
				const pending = new Set<Promise<unknown>>()
				const html = renderToStringWithReads(
					() => () => island(component, props, slots),
					options,
					awaitState
						? (value, token, readStore) => {
								if (readStore === store) reads.set(token.key, token)
								if (value instanceof Promise) {
									pending.add(value)
								}
							}
						: undefined,
				)
				if (!pending.size)
					return {
						html,
						// Even a cached synchronous server read can be async in the browser.
						...(reads.size
							? {
									attrs: {
										"data-spa-reads": JSON.stringify([...reads.values()]),
									},
								}
							: {}),
					}
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
