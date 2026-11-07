import {
	browserResumption,
	captureElement,
	createResumption,
} from "resumability/astro-client"

import { browserApplication } from "./astro-application.ts"
import { createHydrator } from "./astro-client.ts"

export default createHydrator((store, _props, { element, application }) => {
	const scopes = application.get(
		createResumption,
		() => new WeakMap<object, ReturnType<typeof createResumption>>(),
	)
	let scope = scopes.get(store)
	if (!scope) {
		const shared = application === browserApplication(element!.ownerDocument)
		if (shared) {
			const host = browserResumption(element!.ownerDocument)
			application.onCleanup(host.resumeWhen(() => application.canResume))
			scope = host
		} else {
			// Lazy defaults can run after component setup. Bind their private owner so
			// refreshes and pending work end with this island instead of the page.
			const original = store.runDefault
			const local = createResumption()
			store.runDefault = <T>(run: () => T): T =>
				local.run(() => original.call(store, run) as T, {
					resume: application.canResume,
				})
			application.onCleanup(() => {
				local.dispose()
				store.runDefault = original
			})
			scope = local
		}
		scopes.set(store, scope)
	}
	captureElement(scope, element!)
})
