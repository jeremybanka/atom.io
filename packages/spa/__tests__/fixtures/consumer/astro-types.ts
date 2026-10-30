import type {
	AstroApplicationContext,
	AstroStoreContext,
	AstroStoreFactory,
	AstroStorePreparation,
	Island,
} from "@atom.io/spa/astro"
import { jsx } from "@atom.io/spa/jsx-runtime"
import { Silo } from "atom.io"

const factory: AstroStoreFactory<{ message: string }> = async (
	props,
	context,
) => {
	const element: HTMLElement | undefined = context.element
	void element
	context.signal.throwIfAborted()
	context.onCleanup(() => {})
	await Promise.resolve(props.message)
	return new Silo({ name: `typed`, lifespan: `ephemeral`, isProduction: true })
		.store
}
export const App: Island<{ message: string }> = Object.assign(
	(props: { message: string }) => jsx(`p`, { children: props.message }),
	{ createStore: factory },
)
// @ts-expect-error A store factory must return a RootStore or a promise of one.
export const invalid: AstroStoreFactory = () => 42

export function contextContract(context: AstroStoreContext): void {
	// @ts-expect-error SSR does not provide a browser element.
	const host: HTMLElement = context.element
	void host
	// @ts-expect-error Cleanup registration requires a callback.
	context.onCleanup(null)
}

const prepare: AstroStorePreparation<{ message: string }> = async (
	store,
	props,
	context,
) => {
	await Promise.resolve(props.message)
	context.onCleanup(() => {})
	const application: AstroApplicationContext = context.application
	const resource: Promise<string> = application.get(prepare, () =>
		Promise.resolve(props.message),
	)
	await resource
	application.onCleanup(() => {})
	application.signal.throwIfAborted()
	const canResume: boolean = application.canResume
	void canResume
	// @ts-expect-error The adapter owns hydration eligibility.
	application.canResume = true
	const key: string = store.config.name
	void key
}
App.prepareStore = prepare
App.isolate = true
// @ts-expect-error Isolation is a boolean flag.
App.isolate = `yes`
const invalidResult = Promise.resolve(
	new Silo({ name: `invalid`, lifespan: `ephemeral`, isProduction: true }).store,
)
// @ts-expect-error Asynchronous preparation does not replace the selected store.
export const invalidPreparation: AstroStorePreparation = () => invalidResult
