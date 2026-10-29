/* oxlint-disable typescript/require-await -- Astro requires async renderer callbacks, even for synchronous rendering. */
import type { Island } from "./astro-shared.ts"
import { island, islandStore } from "./astro-shared.ts"
import { hydrate, render } from "./dom.ts"

type Hydrator = (
	component: Island,
	props: Record<string, any>,
	slots: Record<string, string>,
	metadata: { client: string },
) => Promise<void>
const roots = new WeakMap<Element, () => void>()
export default (element: HTMLElement): Hydrator =>
	async (
		component: Island,
		props: Record<string, any>,
		slots: Record<string, string>,
		{ client }: { client: string },
	) => {
		roots.get(element)?.()
		if (client === `only`) element.replaceChildren()
		const root = (client === `only` ? render : hydrate)(
			() => island(component, props, slots),
			element,
			{ store: islandStore(component, props) },
		)
		const dispose = () => {
			element.removeEventListener(`astro:unmount`, dispose)
			roots.delete(element)
			root.dispose()
		}
		roots.set(element, dispose)
		element.addEventListener(`astro:unmount`, dispose, { once: true })
	}
