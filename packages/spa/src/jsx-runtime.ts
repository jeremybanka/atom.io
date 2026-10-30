import type { Child, Component, VNode } from "./core.ts"
import type { HTMLAttributes, NativeElements } from "./jsx-types.d.ts"

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

export const Fragment = (props: { children?: Child }): Child => props.children
export function jsx(
	type: VNode[`type`],
	props: VNode[`props`] | null,
	key?: unknown,
): VNode {
	return {
		type,
		props: key === undefined ? (props ?? {}) : merge(props ?? {}, { key }),
	}
}
export const jsxs = jsx
export const jsxDEV = jsx

/** Preserve lazy props and spread precedence, including keys added by later updates. */
export function merge(
	...sources: (Record<string, any> | (() => Record<string, any>))[]
): Record<string, any> {
	const values = () =>
		sources.map(
			(source) => (typeof source === `function` ? source() : source) ?? {},
		)
	return new Proxy(
		{},
		{
			get: (_, key) =>
				values()
					.reverse()
					.find((source) => Object.hasOwn(source, key))?.[key],
			ownKeys: () => [...new Set(values().flatMap(Object.keys))],
			getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
		},
	)
}

export namespace JSX {
	export type Element = VNode
	export type ElementType = keyof IntrinsicElements | Component
	export interface ElementChildrenAttribute {
		children: {}
	}
	export interface IntrinsicAttributes {
		key?: string | number
	}
	/** Augment this interface to declare attributes for registered custom elements. */
	export interface IntrinsicElements extends NativeElements {
		[tag: `${string}-${string}`]: HTMLAttributes<HTMLElement>
	}
}
