import type { Canonical } from "atom.io/foundations/canonical"

import type { Children, Component, SpaElement } from "./core.ts"
import type { HTMLAttributes, NativeElements } from "./jsx-types.d.ts"
import { merge } from "./props.ts"

export type {
	AriaAttributes,
	DOMAttributes,
	EventAttributes,
	EventHandler,
	HTMLAttributes,
	Ref,
	SVGAttributes,
	TargetedEvent,
} from "./jsx-types.d.ts"
export { merge } from "./props.ts"

/** Optional integrations augment attributes without changing element identity. */
// oxlint-disable-next-line typescript/no-empty-interface -- Optional integrations augment this declaration.
export interface CapabilityAttributes<Kind extends string = string> {}

export const Fragment = (props: { children?: Children }): Children =>
	props.children
export function jsx(
	type: SpaElement[`type`],
	props: SpaElement[`props`] | null,
	key?: Canonical,
): SpaElement {
	return {
		type,
		props: key === undefined ? (props ?? {}) : merge(props ?? {}, { key }),
	}
}
export const jsxs = jsx
export const jsxDEV = jsx

export namespace JSX {
	export type Element = SpaElement
	export type ElementType = keyof IntrinsicElements | Component
	export interface ElementChildrenAttribute {
		children: {}
	}
	export interface IntrinsicAttributes {
		key?: Canonical | undefined
	}
	/** Augment this interface to declare attributes for registered custom elements. */
	export interface IntrinsicElements extends NativeElements {
		[tag: `${string}-${string}`]: HTMLAttributes<HTMLElement>
	}
}
