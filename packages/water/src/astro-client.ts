/* oxlint-disable typescript/require-await -- Astro requires async renderer callbacks, even for synchronous rendering. */
import type { RegularAtomFamilyToken } from "atom.io"
import type { RootStore } from "atom.io/internal"
import {
	createRegularAtomFamily,
	disposeFromStore,
	findInStore,
	setIntoStore,
} from "atom.io/internal"

import type { Island } from "./astro-shared.ts"
import { island, islandStore } from "./astro-shared.ts"
import { onCleanup, useValue } from "./core.ts"
import type { WaterRoot } from "./dom.ts"
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
			return
		}
		previous?.dispose()
		// Astro leaves this streaming sentinel in islands inserted by ClientRouter.
		const sentinel = element.lastChild
		if (sentinel?.nodeType === 8 && sentinel.nodeValue === `astro:end`)
			sentinel.remove()
		const store = islandStore(component, props)
		let family = states.get(store)
		if (!family) {
			family = createRegularAtomFamily<State, number, never>(store, {
				key: `🔍 water islands`,
				default: { props: {}, slots: {} },
			})
			states.set(store, family)
		}
		const state = findInStore(store, family, serial++)
		setIntoStore(store, state, { props, slots })
		let released = false
		const release = () => {
			if (!released) {
				released = true
				disposeFromStore(store, state)
			}
		}
		const mount = () => {
			onCleanup(release)
			const value = useValue(state)
			return () => island(component, value().props, value().slots)
		}
		if (client === `only`) element.replaceChildren()
		let root: WaterRoot
		try {
			root = (client === `only` || previous ? render : hydrate)(mount, element, {
				store,
			})
		} catch (error) {
			release()
			throw error
		}
		const dispose = () => {
			element.removeEventListener(`astro:unmount`, dispose)
			roots.delete(element)
			root.dispose()
		}
		roots.set(element, {
			component,
			update(nextProps, nextSlots) {
				setIntoStore(store, state, { props: nextProps, slots: nextSlots })
				root.flush()
			},
			dispose,
		})
		element.addEventListener(`astro:unmount`, dispose, { once: true })
	}
