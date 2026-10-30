import type { RootStore } from "atom.io/internal"
import { IMPLICIT, Store } from "atom.io/internal"

import { applicationContext } from "./astro-context.ts"

const requests = new WeakMap<Request, ReturnType<typeof createRequest>>()
function createRequest() {
	const application = applicationContext()
	let store: RootStore | undefined
	return {
		application,
		get store(): RootStore {
			application.signal.throwIfAborted()
			if (!store) {
				store = new Store(
					{ name: `spa-request`, lifespan: `ephemeral`, isProduction: true },
					IMPLICIT.STORE,
				) as RootStore
				const selected = store
				application.onCleanup(() => {
					const errors: unknown[] = []
					for (const state of selected.atoms.values()) {
						try {
							state.cleanup?.()
						} catch (error) {
							errors.push(error)
						}
					}
					for (const resource of selected.miscResources.values()) {
						try {
							resource[Symbol.dispose]()
						} catch (error) {
							errors.push(error)
						}
					}
					if (errors.length)
						throw new AggregateError(errors, `spa: request cleanup failed`)
				})
			}
			syncDefinitions(store)
			return store
		},
	}
}
export function requestApplication(
	request: Request,
): ReturnType<typeof createRequest> {
	let app = requests.get(request)
	if (!app) {
		app = createRequest()
		requests.set(request, app)
		const dispose = () => {
			app!.application.dispose()
		}
		request.signal.addEventListener(`abort`, dispose, { once: true })
		app.application.onCleanup(() => {
			request.signal.removeEventListener(`abort`, dispose)
		})
		if (request.signal.aborted) dispose()
	}
	return app
}
/** Install definitions imported after an earlier island started this request. */
export function syncDefinitions(store: RootStore): void {
	const source = IMPLICIT.STORE
	for (const field of [
		`families`,
		`atoms`,
		`readonlySelectors`,
		`writableSelectors`,
		`transactions`,
		`timelineFamilies`,
		`timelines`,
	] as const) {
		for (const [key, resource] of source[field]) {
			if (!store[field].has(key)) resource.install(store)
		}
	}
}
