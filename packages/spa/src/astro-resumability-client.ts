import { createResumption } from "resumability/client"

import { createHydrator } from "./astro-client.ts"

export default createHydrator((store, _props, { element, application }) => {
	const scopes = application.get(
		createResumption,
		() => new WeakMap<object, ReturnType<typeof createResumption>>(),
	)
	let scope = scopes.get(store)
	if (!scope) {
		scope = createResumption()
		scopes.set(store, scope)
		const original = store.runDefault
		const current = scope
		store.runDefault = <T>(run: () => T): T =>
			current.run(() => original.call(store, run) as T, {
				resume: application.canResume,
			})
		application.onCleanup(() => {
			current.dispose()
			store.runDefault = original
		})
	}
	// This callback is only invoked by the browser hydrator, which supplies a host.
	const source = element!.closest(`astro-resumption`)
	if (source) scope.add(source)
	const payload = element!.getAttribute(`data-spa-resumption`)
	if (payload !== null) scope.add(JSON.parse(payload))
})
