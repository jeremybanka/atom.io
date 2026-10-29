import type { RootStore } from "atom.io/internal"
import { IMPLICIT, Store } from "atom.io/internal"

import type { Component, VNode } from "./core.ts"
import { jsx } from "./jsx-runtime.ts"

export type Island = Component & {
	hydrogen?: boolean
	createStore?: (props: Record<string, any>) => RootStore
}
export function islandStore(
	component: Island,
	props: Record<string, any>,
): RootStore {
	return (
		component.createStore?.(props) ??
		(new Store(
			{ name: `hydrogen-island`, lifespan: `ephemeral`, isProduction: true },
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
