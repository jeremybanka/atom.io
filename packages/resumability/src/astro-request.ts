import { createCollection, type ServerCollection } from "./server.ts"
import type { Payload } from "./types.ts"

export interface AstroRequestResumption {
	readonly collection: ServerCollection
	readonly sources: Set<ServerCollection>
	snapshot(): Payload
	dispose(): void
}
const requests = new WeakMap<Request, AstroRequestResumption>()
export function requestResumption(request: Request): AstroRequestResumption {
	let context = requests.get(request)
	if (!context) {
		const collection = createCollection({ signal: request.signal })
		const sources = new Set([collection])
		context = {
			collection,
			sources,
			snapshot() {
				const values = new Map<string, Payload[`values`][number]>()
				for (const source of sources)
					for (const entry of source.snapshot().values) {
						const key = JSON.stringify(entry[0])
						if (!values.has(key)) values.set(key, entry)
					}
				return { version: 1, values: [...values.values()] }
			},
			dispose() {
				collection.dispose()
				sources.clear()
			},
		}
		requests.set(request, context)
	}
	return context
}
