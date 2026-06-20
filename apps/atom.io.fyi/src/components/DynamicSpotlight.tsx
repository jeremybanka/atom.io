import type { VNode } from "preact"
import * as React from "react"

import css from "./DynamicSpotlight.module.css"

export type ElementPosition = Pick<DOMRect, `height` | `left` | `top` | `width`>
export type SpotlightProps = {
	elementId?: null | string
	elementIds?: readonly string[]
	startingPosition?: ElementPosition
	padding?: number
	updateSignals?: unknown[]
	parentRef?: React.RefObject<HTMLElement | null>
	variant?: `surface` | `target`
}
export function DynamicSpotlight({
	elementId = null,
	elementIds,
	startingPosition = {
		top: 0,
		left: 0,
		width: 0,
		height: 0,
	},
	padding = 0,
	updateSignals = [],
	parentRef,
	variant = `target`,
}: SpotlightProps): VNode {
	const hasElementIds = elementIds !== undefined
	const elementIdsKey = (elementIds ?? []).join(`\u0000`)
	const targetElementIds = React.useMemo(
		() =>
			elementIds !== undefined ? [...elementIds] : elementId ? [elementId] : [],
		[elementId, elementIdsKey, hasElementIds],
	)
	const [position, setPosition] = React.useState(startingPosition)
	React.useEffect(() => {
		if (targetElementIds.length === 0) {
			setPosition(startingPosition)
			return
		}

		const elements = targetElementIds.flatMap((id) => {
			const element = document.getElementById(id)
			return element ? [element] : []
		})
		if (elements.length === 0) {
			setPosition(startingPosition)
			return
		}

		const updatePosition = () => {
			const parentRect = parentRef?.current?.getBoundingClientRect()
			const targetRect = elements.reduce(
				(rect, element) => {
					const boundingRect = element.getBoundingClientRect()
					return {
						top: Math.min(rect.top, boundingRect.top),
						left: Math.min(rect.left, boundingRect.left),
						right: Math.max(rect.right, boundingRect.right),
						bottom: Math.max(rect.bottom, boundingRect.bottom),
					}
				},
				{
					top: Number.POSITIVE_INFINITY,
					left: Number.POSITIVE_INFINITY,
					right: Number.NEGATIVE_INFINITY,
					bottom: Number.NEGATIVE_INFINITY,
				},
			)
			setPosition({
				top: targetRect.top - (parentRect?.top ?? 0),
				left: targetRect.left - (parentRect?.left ?? 0),
				width: targetRect.right - targetRect.left,
				height: targetRect.bottom - targetRect.top,
			})
		}

		const resizeObserver =
			typeof ResizeObserver === `undefined`
				? null
				: new ResizeObserver(updatePosition)
		for (const element of elements) {
			resizeObserver?.observe(element)
		}
		if (parentRef?.current) {
			resizeObserver?.observe(parentRef.current)
		}

		updatePosition()
		addEventListener(`resize`, updatePosition)
		addEventListener(`scroll`, updatePosition)
		return () => {
			removeEventListener(`resize`, updatePosition)
			removeEventListener(`scroll`, updatePosition)
			resizeObserver?.disconnect()
		}
	}, [targetElementIds, parentRef, ...updateSignals])

	if (position.width === 0 || position.height === 0) {
		return (
			<dynamic-spotlight
				class={css.class}
				data-spotlight-kind={variant}
				style={{ display: `none` }}
			/>
		)
	}

	return (
		<dynamic-spotlight
			class={css.class}
			data-spotlight-kind={variant}
			style={{
				top: position.top - padding,
				left: position.left - padding,
				width: position.width + padding * 2,
				height: position.height + padding * 2,
			}}
		/>
	)
}
