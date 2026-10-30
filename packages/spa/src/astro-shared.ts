import type { RootStore } from "atom.io/internal"
import { IMPLICIT, Store } from "atom.io/internal"

import type { Component, VNode } from "./core.ts"
import { jsx } from "./jsx-runtime.ts"

export interface AstroStoreContext {
	/** The browser island host; undefined during server rendering. */
	element: HTMLElement | undefined
	/** Aborted when preparation is cancelled or the island is released. */
	signal: AbortSignal
	/** Release resources even if preparation or rendering fails. */
	onCleanup(cleanup: () => void): void
}
export type AstroStoreFactory<P = Record<string, any>> = (
	props: P,
	context: AstroStoreContext,
) => RootStore | Promise<RootStore>
export type Island<P = any> = Component<P> & {
	spa?: boolean
	createStore?: AstroStoreFactory<P>
}
export function islandStore(
	component: Island,
	props: Record<string, any>,
	context: AstroStoreContext,
): RootStore | Promise<RootStore> {
	return (
		component.createStore?.(props, context) ??
		(new Store(
			{ name: `spa-island`, lifespan: `ephemeral`, isProduction: true },
			IMPLICIT.STORE,
		) as RootStore)
	)
}
export function island(
	component: Island,
	props: Record<string, any>,
	slots: Record<string, string>,
): VNode {
	const children = Object.fromEntries(
		Object.entries(slots).map(([name, html]) => [
			name,
			jsx(`astro-slot`, {
				key: html,
				name: name === `default` ? undefined : name,
				innerHTML: html,
			}),
		]),
	)
	return jsx(component, {
		...props,
		slots: children,
		children: children[`default`],
	})
}
