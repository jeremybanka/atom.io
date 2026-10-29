import type { VNode } from "@atom.io/water"
import { onCleanup, onMount } from "@atom.io/water"

import css from "./DynamicSpotlight.module.css"

export type SpotlightProps = {
	elementId?: null | string
	elementIds?: readonly string[]
	padding?: number
	parent: () => HTMLElement | null
	variant?: `surface` | `target`
	hiddenAtViewportWidth?: 960 | 1280
}
export function DynamicSpotlight(props: SpotlightProps): VNode {
	let spotlight: HTMLElement | null = null
	const attach = (node: HTMLElement | null) => {
		spotlight = node
	}
	onMount(() => {
		let frame: number | undefined
		let observed: Element[] = []
		const schedule = () => {
			frame ??= requestAnimationFrame(update)
		}
		const resize = new ResizeObserver(schedule)
		const update = () => {
			frame = undefined
			if (!spotlight) return
			const parent = props.parent()
			const ids = props.elementIds ?? (props.elementId ? [props.elementId] : [])
			const elements = ids.flatMap((id) => {
				const element = document.getElementById(id)
				return element ? [element] : []
			})
			const nextObserved = parent ? [...elements, parent] : elements
			if (
				nextObserved.length !== observed.length ||
				nextObserved.some((element, i) => element !== observed[i])
			) {
				resize.disconnect()
				nextObserved.forEach((element) => {
					resize.observe(element)
				})
				observed = nextObserved
			}
			if (!elements.length) {
				spotlight.style.cssText = `display:none`
				return
			}
			const rects = elements.map((element) => element.getBoundingClientRect())
			const top = Math.min(...rects.map((rect) => rect.top))
			const left = Math.min(...rects.map((rect) => rect.left))
			const width = Math.max(...rects.map((rect) => rect.right)) - left
			const height = Math.max(...rects.map((rect) => rect.bottom)) - top
			const parentRect = parent?.getBoundingClientRect()
			const padding = props.padding ?? 0
			spotlight.style.cssText =
				width && height
					? `top:${top - (parentRect?.top ?? 0) - padding}px;left:${left - (parentRect?.left ?? 0) - padding}px;width:${width + padding * 2}px;height:${height + padding * 2}px`
					: `display:none`
		}
		const mutations = new MutationObserver(schedule)
		const container = props.parent()?.closest(`docs-navigation`)
		if (container)
			mutations.observe(container, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: [
					`data-section-visible`,
					`data-user-has-toggled`,
					`data-pathname`,
				],
			})
		addEventListener(`resize`, schedule)
		addEventListener(`scroll`, schedule, { passive: true })
		document.addEventListener(`astro:page-load`, schedule)
		schedule()
		onCleanup(() => {
			resize.disconnect()
			mutations.disconnect()
			removeEventListener(`resize`, schedule)
			removeEventListener(`scroll`, schedule)
			document.removeEventListener(`astro:page-load`, schedule)
			if (frame !== undefined) cancelAnimationFrame(frame)
		})
	})
	return (
		<dynamic-spotlight
			ref={attach}
			class={css.class}
			data-hidden-at-viewport-width={props.hiddenAtViewportWidth}
			data-spotlight-kind={props.variant ?? `target`}
			style="display:none"
		/>
	)
}
