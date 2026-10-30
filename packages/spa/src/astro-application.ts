import type { ReadableToken } from "atom.io"
import { IMPLICIT, withdraw } from "atom.io/internal"

import { applicationContext } from "./astro-context.ts"

const applications = new WeakMap<
	Document,
	ReturnType<typeof applicationContext>
>()

/** Called by the integration's early page script, before island preparation. */
export function browserApplication(
	document: Document,
): ReturnType<typeof applicationContext> {
	let application = applications.get(document)
	if (application) return application
	application = applicationContext()
	const app = application
	const store = IMPLICIT.STORE
	const originalDefault = store.runDefault
	applications.set(document, app)
	const changed = () => {
		app.canResume = false
	}
	const internal = (key: string) => key.startsWith(`🔍 spa islands`)
	const subscriptions = new Map<string, () => void>()
	const watch = (token: ReadableToken<unknown, any, any>) => {
		if (internal(token.key)) return
		if (store.valueMap.has(token.key)) changed()
		subscriptions.get(token.key)?.()
		const state = withdraw(store, token)
		subscriptions.set(
			token.key,
			state.subject.subscribe(`spa:bootstrap`, changed),
		)
	}
	for (const state of [
		...store.atoms.values(),
		...store.readonlySelectors.values(),
		...store.writableSelectors.values(),
	])
		watch(state)
	const removed = (token: ReadableToken<unknown, any, any>) => {
		if (!internal(token.key)) {
			changed()
			subscriptions.get(token.key)?.()
			subscriptions.delete(token.key)
		}
	}
	const events = [
		store.on.atomCreation.subscribe(`spa:bootstrap`, watch),
		store.on.selectorCreation.subscribe(`spa:bootstrap`, watch),
		store.on.atomDisposal.subscribe(`spa:bootstrap`, removed),
		store.on.selectorDisposal.subscribe(`spa:bootstrap`, removed),
		store.on.transactionCommit.subscribe(`spa:bootstrap`, changed),
	]
	document.addEventListener(`astro:before-swap`, changed)
	const pagehide = (event: PageTransitionEvent) => {
		if (!event.persisted) app.dispose()
	}
	document.defaultView?.addEventListener(`pagehide`, pagehide)
	app.onCleanup(() => {
		for (const unsubscribe of subscriptions.values()) unsubscribe()
		for (const unsubscribe of events) unsubscribe()
		document.removeEventListener(`astro:before-swap`, changed)
		document.defaultView?.removeEventListener(`pagehide`, pagehide)
		store.runDefault = originalDefault
		applications.delete(document)
	})
	return app
}
