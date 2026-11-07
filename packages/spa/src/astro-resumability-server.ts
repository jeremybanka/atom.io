import type { NamedSSRLoadedRendererValue } from "astro"
import {
	createCollection,
	currentCollection,
	serialize,
	type ServerCollection,
} from "resumability/server"

import { requestApplication } from "./astro-request.ts"
import { createRenderer } from "./astro-server.ts"

const renderer = createRenderer(true)
const requestCollections = Symbol(`spa resumption collections`)
const automatic: NamedSSRLoadedRendererValue = {
	...renderer,
	async renderToStaticMarkup(...args) {
		const request = (this as unknown as { result?: { request: Request } }).result
			?.request
		const application = request
			? requestApplication(request).application
			: undefined
		const component = args[0]
		const shared = application && !component.createStore && !component.isolate
		const registry = shared
			? application.get(requestCollections, () => {
					const collection = createCollection({ signal: application.signal })
					application.onCleanup(collection.dispose)
					return { collection, sources: new Set<ServerCollection>() }
				})
			: undefined
		const explicit = currentCollection()
		const scope =
			explicit ??
			registry?.collection ??
			createCollection(application ? { signal: application.signal } : {})
		registry?.sources.add(scope)
		try {
			const { value: result } = await scope.collect(
				() => renderer.renderToStaticMarkup.apply(this, args),
				{ drain: false },
			)
			// A shared store can reuse defaults from an earlier explicit collection.
			// Include completed seeds from those scopes even if another island hydrates first.
			const values = new Map<
				string,
				ReturnType<ServerCollection[`snapshot`]>[`values`][number]
			>()
			for (const source of registry?.sources ?? [scope]) {
				for (const entry of source.snapshot().values) {
					const key = JSON.stringify(entry[0])
					if (!values.has(key)) values.set(key, entry)
				}
			}
			return {
				...result,
				attrs: {
					...result.attrs,
					"data-spa-resumption": serialize({
						version: 1,
						values: [...values.values()],
					}),
				},
			}
		} finally {
			if (!explicit && !registry) scope.dispose()
		}
	},
}
export default automatic
