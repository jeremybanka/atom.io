import type { NamedSSRLoadedRendererValue } from "astro"

import { requestResumption } from "./astro-request.ts"
import { createCollection, currentCollection, serialize } from "./server.ts"

export { requestResumption } from "./astro-request.ts"
export function resumableRenderer(
	renderer: NamedSSRLoadedRendererValue,
	options: { isolate?: (component: any) => boolean } = {},
): NamedSSRLoadedRendererValue {
	return {
		...renderer,
		async renderToStaticMarkup(...args) {
			const request = (this as unknown as { result?: { request: Request } })
				.result?.request
			const host = request ? requestResumption(request) : undefined
			const isolated = options.isolate?.(args[0]) === true
			const ambient = currentCollection()
			const explicit =
				ambient && ambient !== host?.collection ? ambient : undefined
			const scope =
				explicit ??
				(isolated ? undefined : host?.collection) ??
				createCollection(host ? { signal: host.collection.signal } : {})
			if (!isolated) host?.sources.add(scope)
			try {
				const { value: result } = await scope.collect(
					() => renderer.renderToStaticMarkup.apply(this, args),
					{ drain: false },
				)
				const payload = !isolated && host ? host.snapshot() : scope.snapshot()
				return {
					...result,
					attrs: {
						...result.attrs,
						"data-resumability": serialize(payload),
						...(isolated ? { "data-resumability-private": `` } : {}),
					},
				}
			} finally {
				if (!explicit && (isolated || !host)) scope.dispose()
			}
		},
	}
}
