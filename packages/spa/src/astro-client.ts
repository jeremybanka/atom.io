import type { RegularAtomFamilyToken } from "atom.io"
import type { RootStore } from "atom.io/internal"
import {
	createRegularAtomFamily,
	disposeFromStore,
	findInStore,
	IMPLICIT,
	setIntoStore,
} from "atom.io/internal"

import { browserApplication } from "./astro-application.ts"
import { failPreparation, storeContext } from "./astro-context.ts"
import type { Island } from "./astro-shared.ts"
import { island, islandStore } from "./astro-shared.ts"
import { onCleanup, useValue } from "./core.ts"
import { hydrate, render } from "./dom.ts"

type Props = Record<string, any>
type Slots = Record<string, string>
type Hydrator = (
	component: Island,
	props: Props,
	slots: Slots,
	metadata: { client: string },
) => Promise<void>
const roots = new WeakMap<
	Element,
	{
		component: Island
		ready: Promise<void>
		update(props: Props, slots: Slots): void
		dispose(): void
	}
>()
type State = { props: Props; slots: Slots }
const states = new WeakMap<RootStore, RegularAtomFamilyToken<State, number>>()
let serial = 0

export default (element: HTMLElement): Hydrator =>
	async (component, props, slots, { client }) => {
		const previous = roots.get(element)
		if (previous?.component === component) {
			previous.update(props, slots)
			return previous.ready
		}
		previous?.dispose()
		const shared = !component.createStore && !component.isolate
		const application = shared
			? browserApplication(element.ownerDocument)
			: undefined
		if (application && client === `only`) application.canResume = false
		const lifetime = storeContext(element, application)
		const initial = { props, slots }
		let current = initial
		let update: ((value: State) => void) | undefined
		let disposed = false
		const dispose = () => {
			if (disposed) return
			disposed = true
			element.removeEventListener(`astro:unmount`, dispose)
			roots.delete(element)
			lifetime.dispose()
		}
		// Publish the pending owner before invoking user code. Repeated hydration
		// calls update its props and share its preparation rather than racing stores.
		const ready = Promise.resolve().then(async () => {
			if (lifetime.context.signal.aborted) return
			let mounting = false
			try {
				const store = await Promise.race([
					islandStore(
						component,
						props,
						lifetime.context,
						shared ? IMPLICIT.STORE : undefined,
					),
					lifetime.cancelled,
				])
				if (lifetime.context.signal.aborted) return
				mounting = true
				const replace =
					client === `only` ||
					previous !== undefined ||
					application?.canResume === false
				// Astro leaves this sentinel on islands inserted by ClientRouter.
				const sentinel = element.lastChild
				if (sentinel?.nodeType === 8 && sentinel.nodeValue === `astro:end`)
					sentinel.remove()
				let family = states.get(store!)
				if (!family) {
					family = createRegularAtomFamily<State, number, never>(store!, {
						key: `🔍 spa islands`,
						default: { props: {}, slots: {} },
					})
					states.set(store!, family)
				}
				const state = findInStore(store!, family, serial++)
				setIntoStore(store!, state, replace ? current : initial)
				lifetime.context.onCleanup(() => {
					disposeFromStore(store!, state)
				})
				const mount = () => {
					onCleanup(dispose)
					const value = useValue(state)
					return () => island(component, value().props, value().slots)
				}
				if (replace) element.replaceChildren()
				const root = (replace ? render : hydrate)(mount, element, {
					store: store!,
				})
				lifetime.context.onCleanup(root.dispose)
				update = (next) => {
					setIntoStore(store!, state, next)
					root.flush()
				}
				// Match the existing SSR tree before applying a structural prop update
				// that arrived while its store was still being prepared.
				if (!replace && current !== initial) update(current)
			} catch (error) {
				if (lifetime.context.signal.aborted && !mounting) return
				failPreparation(error, dispose)
			}
		})
		roots.set(element, {
			component,
			ready,
			update(nextProps, nextSlots) {
				current = { props: nextProps, slots: nextSlots }
				update?.(current)
			},
			dispose,
		})
		element.addEventListener(`astro:unmount`, dispose, { once: true })
		lifetime.context.onCleanup(dispose)
		return ready
	}
