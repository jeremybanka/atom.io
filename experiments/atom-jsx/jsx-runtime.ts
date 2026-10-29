import type { ReadableToken } from "atom.io"

import type { Child, Component, Projection, VNode } from "./runtime.ts"

export { Fragment, jsx, jsxDEV, jsxs } from "./runtime.ts"

// Deliberately small DOM typing surface; this is not a React types adapter.
export namespace JSX {
	export type Element = VNode
	export type ElementType = keyof IntrinsicElements | Component
	export interface ElementChildrenAttribute {
		children: {}
	}
	export interface IntrinsicAttributes {
		key?: never
	}
	type Props = {
		children?: Child
		class?: string | ReadableToken<string> | Projection<string>
		className?: string | ReadableToken<string> | Projection<string>
		style?: string | ReadableToken<string> | Projection<string>
		onClick?: (event: MouseEvent) => void
		onInput?: (event: Event) => void
		ref?: (element: any) => void
		[name: string]: unknown
	}
	export type IntrinsicElements = {
		[Tag in keyof HTMLElementTagNameMap | keyof SVGElementTagNameMap]: Props
	}
}
