/** @jsxImportSource @atom.io/spa */
import css from "./BrandMark.module.css"
import type { BrandMarkScene } from "./BrandMarkScene.tsx"
import type { SpaElement } from "./core.ts"
import { invalidate, onCleanup, onMount, owner } from "./core.ts"
import { jsx } from "./jsx-runtime.ts"

export interface BrandMarkProps {
	/** Compact mark by default; splash fills the viewport behind page content. */
	variant?: `mark` | `splash`
	/** Mark width and height in CSS pixels. Defaults to 22; ignored for splash. */
	size?: number
	class?: string
}
/** Render the shared dz² orbital, retaining a static fallback until WebGL is ready. */
export function BrandMark(props: BrandMarkProps): SpaElement {
	const scope = owner!
	let Scene: typeof BrandMarkScene | undefined
	let ready = false,
		failed = false,
		active = true
	let host: HTMLElement | null = null
	let width = props.size ?? 22,
		height = width
	onCleanup(() => {
		active = false
	})
	onMount(() => {
		const view = host!.ownerDocument.defaultView!
		const resize = () => {
			const fallback =
				props.variant === `splash`
					? [view.innerWidth * 2, view.innerHeight * 2]
					: [props.size ?? 22, props.size ?? 22]
			const nextWidth = Math.max(1, host!.clientWidth || fallback[0])
			const nextHeight = Math.max(1, host!.clientHeight || fallback[1])
			if (width !== nextWidth || height !== nextHeight) {
				width = nextWidth
				height = nextHeight
				invalidate(scope)
			}
		}
		const observer = new view.ResizeObserver(resize)
		observer.observe(host!)
		view.addEventListener(`resize`, resize)
		resize()
		onCleanup(() => {
			observer.disconnect()
			view.removeEventListener(`resize`, resize)
		})
		void import(`./BrandMarkScene.tsx`)
			.then(({ BrandMarkScene: component }) => {
				if (active) {
					Scene = component
					invalidate(scope)
				}
			})
			.catch(() => {
				if (active) {
					failed = true
					invalidate(scope)
				}
			})
	})
	return (
		<brand-mark
			class={`${css[`class`]} ${props.class ?? ``}`}
			aria-hidden="true"
			data-variant={props.variant ?? `mark`}
			data-size={props.variant === `splash` ? undefined : (props.size ?? 22)}
			data-live={ready && !failed}
			style={
				props.variant === `splash`
					? ``
					: `width:${props.size ?? 22}px;height:${props.size ?? 22}px;flex:0 0 ${props.size ?? 22}px`
			}
			ref={(element) => {
				host = element
			}}
		>
			{Scene &&
				!failed &&
				jsx(Scene, {
					get variant() {
						return props.variant ?? `mark`
					},
					get width() {
						return width
					},
					get height() {
						return height
					},
					get view() {
						return host!.ownerDocument.defaultView!
					},
					onReady: () => {
						ready = true
						invalidate(scope)
					},
					onError: () => {
						failed = true
						invalidate(scope)
					},
				})}
		</brand-mark>
	)
}
